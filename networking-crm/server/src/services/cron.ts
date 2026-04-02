import cron from "node-cron";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { generateFollowUps, ContactWithCounts } from "./followup-engine";
import { batchPersonalizeFollowUps, BatchPersonalizeItem } from "./message-drafting";
import {
  generateDailyChallenge,
  generateAlternativeChallenges,
} from "./challenge-engine";

export async function runDailyJob(): Promise<void> {
  logger.info(`[cron] Running daily job at ${new Date().toISOString()}`);

  try {
    // a. Warmth decay — single bulk update + batch insert interaction notes
    await applyWarmthDecay();

    // b. Follow-up generation — smart query + batch AI personalization
    await generateAllFollowUps();

    // c. Stale follow-ups — single bulk update
    await bumpStaleFollowUpPriority();

    // d. Daily challenge generation
    await ensureDailyChallenge();

    // e. Cleanup expired sessions
    await prisma.session.deleteMany({ where: { expires_at: { lt: new Date() } } });

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
 */
async function generateAllFollowUps(): Promise<void> {
  const now = new Date();

  // Time boundaries for new/warming contacts (based on created_at)
  const threeDaysAgo = new Date(now);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const fiveDaysAgo = new Date(now);
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const eightDaysAgo = new Date(now);
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const twentyTwoDaysAgo = new Date(now);
  twentyTwoDaysAgo.setDate(twentyTwoDaysAgo.getDate() - 22);

  // Time boundaries for warm contacts (based on last_interaction_at)
  const twentyOneDaysAgo = new Date(now);
  twentyOneDaysAgo.setDate(twentyOneDaysAgo.getDate() - 21);
  const twentyNineDaysAgo = new Date(now);
  twentyNineDaysAgo.setDate(twentyNineDaysAgo.getDate() - 29);
  const fortyTwoDaysAgo = new Date(now);
  fortyTwoDaysAgo.setDate(fortyTwoDaysAgo.getDate() - 42);
  const fiftySevenDaysAgo = new Date(now);
  fiftySevenDaysAgo.setDate(fiftySevenDaysAgo.getDate() - 57);

  // Time boundary for paused contacts
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  // Single query: contacts that potentially need follow-ups, with counts
  const candidates = await prisma.contact.findMany({
    where: {
      AND: [
        { warmth_status: { notIn: ["archived"] } },
        {
          OR: [
            // new/warming: created in relevant time windows
            {
              warmth_status: { in: ["new", "warming"] },
              OR: [
                { created_at: { gte: threeDaysAgo } },
                { created_at: { gte: eightDaysAgo, lt: fiveDaysAgo } },
                { created_at: { gte: twentyTwoDaysAgo, lt: fourteenDaysAgo } },
              ],
            },
            // warm: last interaction 21-29 or 42-57 days ago
            {
              warmth_status: "warm",
              OR: [
                { last_interaction_at: { gte: twentyNineDaysAgo, lt: twentyOneDaysAgo } },
                { last_interaction_at: { gte: fiftySevenDaysAgo, lt: fortyTwoDaysAgo } },
              ],
            },
            // cooling: always eligible
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
      last_interaction_at: true,
      created_at: true,
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

  const [pendingCounts, skippedCounts] = await Promise.all([
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
  ]);

  const pendingMap = new Map(pendingCounts.map((r) => [r.contact_id, r._count]));
  const skippedMap = new Map(skippedCounts.map((r) => [r.contact_id, r._count]));

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
      last_interaction_at: candidate.last_interaction_at,
      created_at: candidate.created_at,
      pendingCount: pendingMap.get(candidate.id) ?? 0,
      skippedCount: skippedMap.get(candidate.id) ?? 0,
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

export function startCron(): void {
  // Run daily at 08:00 UTC
  cron.schedule("0 8 * * *", () => {
    runDailyJob().catch((err) => logger.error("Cron error", { error: String(err) }));
  });
  logger.info("[cron] Scheduled daily job at 08:00 UTC");
}
