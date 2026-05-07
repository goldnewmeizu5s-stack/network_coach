import cron from "node-cron";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { generateFollowUps, ContactWithCounts } from "./followup-engine";
import { applyInterestDecay, evaluateInterestTiers } from "./interest";
import { batchPersonalizeFollowUps, BatchPersonalizeItem } from "./message-drafting";
import {
  generateDailyChallenge,
  generateAlternativeChallenges,
} from "./challenge-engine";
import { consolidateAllContacts } from "./memory/consolidation";
import { refreshReactionInsights } from "./challenge-reactions";
import {
  sendMorningBriefing,
  sendFollowUpReminders,
  sendWeeklyDigest,
} from "../bot/notifications";

/**
 * Add a random delay (0–25 min) before sending a notification.
 * This breaks the "always at XX:00" pattern that the brain learns to ignore.
 */
function withJitter(fn: () => Promise<void>, maxMinutes = 25): () => void {
  return () => {
    const delayMs = Math.floor(Math.random() * maxMinutes * 60 * 1000);
    setTimeout(() => {
      fn().catch((err) => logger.error("Jittered notification error", { error: String(err) }));
    }, delayMs);
  };
}

export async function runDailyJob(): Promise<void> {
  logger.info(`[cron] Running daily job at ${new Date().toISOString()}`);

  try {
    // a. Warmth decay — single bulk update + batch insert interaction notes
    await applyWarmthDecay();

    // a2. Interest decay + tier evaluation — runs before follow-up generation
    //     so the engine sees the right tier for each contact.
    await applyInterestDecay();
    await evaluateInterestTiers();

    // b. Follow-up generation — smart query + batch AI personalization
    await generateAllFollowUps();

    // c. Stale follow-ups — single bulk update
    await bumpStaleFollowUpPriority();

    // d. Daily challenge generation
    await ensureDailyChallenge();

    // e. Cleanup expired sessions
    await prisma.session.deleteMany({ where: { expires_at: { lt: new Date() } } });

    // f. Send morning briefing via Telegram (with jitter so it doesn't always arrive at 08:00 sharp)
    try {
      const jitterMs = Math.floor(Math.random() * 20 * 60 * 1000); // 0-20 min
      setTimeout(() => {
        sendMorningBriefing().catch((err) =>
          logger.error("[cron] Morning briefing failed", { error: String(err) }),
        );
      }, jitterMs);
    } catch (err) {
      logger.error("[cron] Morning briefing scheduling failed", { error: String(err) });
    }

    logger.info(`[cron] Daily job completed`);
  } catch (err) {
    logger.error("Daily job failed", { error: String(err) });
  }
}

/**
 * Transition warm contacts with no interaction for 30+ days to cooling.
 * Uses updateMany for contacts, then creates interaction notes in one pass.
 */
async function applyWarmthDecay(): Promise<void> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Find IDs first (we need them for interaction notes)
  const decaying = await prisma.contact.findMany({
    where: {
      warmth_status: "warm",
      last_interaction_at: { lt: thirtyDaysAgo },
    },
    select: { id: true, full_name: true },
  });

  if (decaying.length === 0) return;

  const ids = decaying.map((c) => c.id);

  // Bulk update status
  await prisma.contact.updateMany({
    where: { id: { in: ids } },
    data: { warmth_status: "cooling" },
  });

  // Bulk create interaction notes
  await prisma.interaction.createMany({
    data: ids.map((id) => ({
      contact_id: id,
      type: "note",
      content: "Status auto-changed from warm to cooling (no interaction for 30+ days)",
    })),
  });

  for (const c of decaying) {
    logger.info(`[cron] ${c.full_name}: warm → cooling (decay)`);
  }
}

/**
 * Load only contacts that potentially need follow-ups using targeted queries,
 * generate drafts, batch-personalize with one AI call, and bulk-insert.
 *
 * Query strategy: cast a wide net with simple date thresholds, then let the
 * pure-logic engine decide the exact action. This avoids complex overlapping
 * time-window queries and keeps the DB filter cheap.
 */
async function generateAllFollowUps(): Promise<void> {
  const now = new Date();

  // new/warming: never contacted and created 1+ day ago, OR contacted 5+ days ago
  const oneDayAgo = new Date(now);
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const fiveDaysAgo = new Date(now);
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  // warm: last interaction 14+ days ago (engine checks 14-22 and 22-30 windows)
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  // paused: last interaction 60+ days ago
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const candidates = await prisma.contact.findMany({
    where: {
      AND: [
        { warmth_status: { notIn: ["archived"] } },
        {
          OR: [
            // new/warming: never contacted (created 1+ day ago) OR contacted 5+ days ago
            {
              warmth_status: { in: ["new", "warming"] },
              OR: [
                { last_interaction_at: null, created_at: { lt: oneDayAgo } },
                { last_interaction_at: { not: null, lt: fiveDaysAgo } },
              ],
            },
            // warm: last interaction 14+ days ago (before 30d decay kicks in)
            {
              warmth_status: "warm",
              last_interaction_at: { lt: fourteenDaysAgo },
            },
            // cooling: always eligible (status itself is the trigger)
            { warmth_status: "cooling" },
            // paused: last interaction 60+ days ago
            {
              warmth_status: "paused",
              OR: [
                { last_interaction_at: { lt: sixtyDaysAgo } },
                { last_interaction_at: null },
              ],
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      full_name: true,
      warmth_status: true,
      key_interests: true,
      where_met: true,
      occupation: true,
      potential_synergies: true,
      last_interaction_at: true,
      created_at: true,
      interest_tier: true,
    },
  });

  if (candidates.length === 0) return;

  // Get pending and skipped follow-up counts in two bulk queries
  const candidateIds = candidates.map((c) => c.id);

  // Exclude contacts with active snoozed follow-ups
  const snoozedContacts = await prisma.followUp.findMany({
    where: { contact_id: { in: candidateIds }, status: "snoozed", snoozed_until: { gt: new Date() } },
    select: { contact_id: true },
  });
  const snoozedSet = new Set(snoozedContacts.map(f => f.contact_id));
  const filteredCandidates = candidates.filter(c => !snoozedSet.has(c.id));

  if (filteredCandidates.length === 0) return;

  const filteredIds = filteredCandidates.map((c) => c.id);

  const [pendingCounts, skippedCounts, doneCounts, openGoalRows] = await Promise.all([
    prisma.followUp.groupBy({
      by: ["contact_id"],
      where: { contact_id: { in: filteredIds }, status: "pending" },
      _count: true,
    }),
    prisma.followUp.groupBy({
      by: ["contact_id"],
      where: { contact_id: { in: filteredIds }, status: "skipped" },
      _count: true,
    }),
    prisma.followUp.groupBy({
      by: ["contact_id"],
      where: { contact_id: { in: filteredIds }, status: "done" },
      _count: true,
    }),
    prisma.interestGoal.findMany({
      where: { contact_id: { in: filteredIds }, status: "open" },
      select: { contact_id: true, description: true, last_mentioned_at: true },
      orderBy: { last_mentioned_at: "desc" },
    }),
  ]);

  const pendingMap = new Map(pendingCounts.map((r) => [r.contact_id, r._count]));
  const skippedMap = new Map(skippedCounts.map((r) => [r.contact_id, r._count]));
  const doneMap = new Map(doneCounts.map((r) => [r.contact_id, r._count]));
  const goalsMap = new Map<string, string[]>();
  for (const row of openGoalRows) {
    const arr = goalsMap.get(row.contact_id) ?? [];
    arr.push(row.description);
    goalsMap.set(row.contact_id, arr);
  }

  // Generate drafts (pure logic, no DB calls)
  const allDrafts: {
    draft: ReturnType<typeof generateFollowUps>[number];
    contact: typeof candidates[number];
  }[] = [];

  for (const candidate of filteredCandidates) {
    const contactData: ContactWithCounts = {
      id: candidate.id,
      full_name: candidate.full_name,
      warmth_status: candidate.warmth_status,
      key_interests: candidate.key_interests,
      where_met: candidate.where_met ?? null,
      occupation: candidate.occupation ?? null,
      potential_synergies: candidate.potential_synergies ?? null,
      last_interaction_at: candidate.last_interaction_at,
      created_at: candidate.created_at,
      interest_tier: candidate.interest_tier,
      open_goals: goalsMap.get(candidate.id) ?? [],
      pendingCount: pendingMap.get(candidate.id) ?? 0,
      skippedCount: skippedMap.get(candidate.id) ?? 0,
      doneCount: doneMap.get(candidate.id) ?? 0,
    };

    const drafts = generateFollowUps(contactData);
    for (const draft of drafts) {
      allDrafts.push({ draft, contact: candidate });
    }
  }

  if (allDrafts.length === 0) return;

  // Batch AI personalization — one API call for up to 15 items
  const BATCH_LIMIT = 15;
  const toPersonalize: BatchPersonalizeItem[] = allDrafts
    .slice(0, BATCH_LIMIT)
    .map((item, i) => ({
      index: i,
      contactName: item.contact.full_name,
      templateAction: item.draft.suggested_action,
      contactInterests: item.contact.key_interests,
      whereMet: item.contact.where_met,
    }));

  let personalizedTexts = new Map<number, string>();
  if (toPersonalize.length > 0) {
    try {
      personalizedTexts = await batchPersonalizeFollowUps(toPersonalize);
    } catch {
      // Keep template texts on failure
    }
  }

  // Apply personalized texts and bulk-insert all follow-ups
  const followUpData = allDrafts.map((item, i) => ({
    ...item.draft,
    suggested_action: personalizedTexts.get(i) || item.draft.suggested_action,
  }));

  await prisma.followUp.createMany({ data: followUpData });

  const personalizedCount = personalizedTexts.size;
  logger.info(
    `[cron] Generated ${followUpData.length} follow-ups (${personalizedCount} AI-personalized) from ${filteredCandidates.length} candidates`
  );
}

/**
 * Bump priority on follow-ups overdue by 7+ days.
 * Uses raw SQL for atomic increment without loading each row.
 */
async function bumpStaleFollowUpPriority(): Promise<void> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const result = await prisma.followUp.updateMany({
    where: {
      status: "pending",
      due_date: { lt: sevenDaysAgo },
      priority: { lt: 10 },
    },
    data: { priority: { increment: 2 } },
  });

  // Clamp any values that exceeded 10
  if (result.count > 0) {
    await prisma.followUp.updateMany({
      where: { priority: { gt: 10 } },
      data: { priority: 10 },
    });
    logger.info(`[cron] Bumped priority on ${result.count} stale follow-ups`);
  }
}

async function ensureDailyChallenge(): Promise<void> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86400000);

  const existingChallenge = await prisma.challenge.count({
    where: { date: { gte: todayStart, lt: todayEnd } },
  });

  if (existingChallenge === 0) {
    try {
      await generateDailyChallenge();
      await generateAlternativeChallenges();
      logger.info("[cron] Generated daily challenge + alternatives");
    } catch (err) {
      logger.error("Challenge generation failed", { error: String(err) });
    }
  }
}

export async function runWeeklyMemoryJob(): Promise<void> {
  logger.info(`[cron] Running weekly memory job at ${new Date().toISOString()}`);
  try {
    const insights = await refreshReactionInsights();
    logger.info("[cron] Reaction insights refreshed", {
      categories: insights.by_category.length,
      loved: insights.loved.length,
      rejected: insights.rejected.length,
    });
  } catch (err) {
    logger.error("[cron] Reaction insights failed", { error: String(err) });
  }
  try {
    const result = await consolidateAllContacts();
    logger.info("[cron] Contact memory consolidated", result);
  } catch (err) {
    logger.error("[cron] Memory consolidation failed", { error: String(err) });
  }
}

const scheduledJobs: ReturnType<typeof cron.schedule>[] = [];

export function startCron(): void {
  // Run daily at 08:00 UTC
  scheduledJobs.push(
    cron.schedule("0 8 * * *", () => {
      runDailyJob().catch((err) => logger.error("Cron error", { error: String(err) }));
    })
  );

  // Follow-up reminders at 12:00 and 18:00 UTC (with jitter: +0-25 min)
  scheduledJobs.push(
    cron.schedule("0 12,18 * * *", withJitter(sendFollowUpReminders, 25))
  );

  // Weekly digest on Mondays at 10:00 UTC (with jitter: +0-20 min)
  scheduledJobs.push(
    cron.schedule("0 10 * * 1", withJitter(sendWeeklyDigest, 20))
  );

  // Weekly memory consolidation on Sundays at 03:00 UTC
  scheduledJobs.push(
    cron.schedule("0 3 * * 0", () => {
      runWeeklyMemoryJob().catch((err) =>
        logger.error("Weekly memory cron error", { error: String(err) }),
      );
    }),
  );

  logger.info(
    "[cron] Scheduled: daily 08:00, reminders 12:00/18:00, weekly Mon 10:00, memory Sun 03:00 UTC",
  );
}

export function stopCron(): void {
  for (const job of scheduledJobs) {
    job.stop();
  }
  scheduledJobs.length = 0;
  logger.info("[cron] All scheduled jobs stopped");
}
