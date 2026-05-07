import prisma from "../lib/prisma";

/**
 * Interest tracking — orthogonal to warmth.
 *
 * - "warmth" = how active the relationship is (recent interactions).
 * - "interest" = whether the user still wants something specific from this person.
 *
 * Three tiers control follow-up cadence regardless of warmth:
 *   active       — normal warmth-based cadence (existing behaviour)
 *   maintenance  — one light touch ~every 30 days
 *   dormant      — one "still alive?" ping ~every 90 days
 *
 * Interest score (0-100) is recomputed on demand from open goals,
 * recent goal events, and follow-up reliability, then applied with
 * a half-life decay since the last decay timestamp.
 */

export const INTEREST_TIERS = ["active", "maintenance", "dormant"] as const;
export type InterestTier = (typeof INTEREST_TIERS)[number];

const HALF_LIFE_DAYS = 30;
const DECAY_RATE = Math.LN2 / HALF_LIFE_DAYS;

const SCORE_BASELINE = 50;
const SCORE_PER_OPEN_GOAL = 15;
const MAX_OPEN_GOAL_BONUS = 30;
const RECENT_MENTION_BONUS = 10;
const RECENT_MENTION_WINDOW_DAYS = 14;
const RECENT_SATISFACTION_BONUS = 5;
const RECENT_SATISFACTION_WINDOW_DAYS = 30;
const SKIP_PENALTY = 10;
const SKIP_PENALTY_WINDOW = 5;

const ACTIVE_THRESHOLD = 50;
const ACTIVE_RECOVER = 60;
const DORMANT_THRESHOLD = 20;

const MAINTENANCE_QUIET_DAYS = 14;
const DORMANT_QUIET_DAYS = 30;

function daysAgo(date: Date | null | undefined): number {
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

export interface InterestScoreInputs {
  openGoalCount: number;
  lastGoalMentionedAt: Date | null;
  lastGoalSatisfiedAt: Date | null;
  recentSkipsOrDeclines: number;
  decayedAt: Date;
}

export function computeInterestScore(input: InterestScoreInputs): number {
  let score = SCORE_BASELINE;
  score += Math.min(input.openGoalCount * SCORE_PER_OPEN_GOAL, MAX_OPEN_GOAL_BONUS);
  if (
    input.lastGoalMentionedAt &&
    daysAgo(input.lastGoalMentionedAt) <= RECENT_MENTION_WINDOW_DAYS
  ) {
    score += RECENT_MENTION_BONUS;
  }
  if (
    input.lastGoalSatisfiedAt &&
    daysAgo(input.lastGoalSatisfiedAt) <= RECENT_SATISFACTION_WINDOW_DAYS
  ) {
    score += RECENT_SATISFACTION_BONUS;
  }
  if (input.recentSkipsOrDeclines >= SKIP_PENALTY_WINDOW) {
    score -= SKIP_PENALTY;
  }

  // Apply decay since last recorded decay timestamp.
  const days = daysAgo(input.decayedAt);
  if (days > 0 && Number.isFinite(days)) {
    score = score * Math.exp(-DECAY_RATE * days);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

async function loadScoreInputs(contactId: string): Promise<InterestScoreInputs & { lastGoalEventAt: Date | null }> {
  const [openGoals, lastMention, lastSatisfied, recentFollowUps, contact] = await Promise.all([
    prisma.interestGoal.count({
      where: { contact_id: contactId, status: "open" },
    }),
    prisma.interestGoal.findFirst({
      where: { contact_id: contactId, status: "open" },
      orderBy: { last_mentioned_at: "desc" },
      select: { last_mentioned_at: true },
    }),
    prisma.interestGoal.findFirst({
      where: { contact_id: contactId, status: "satisfied" },
      orderBy: { satisfied_at: "desc" },
      select: { satisfied_at: true },
    }),
    prisma.followUp.findMany({
      where: { contact_id: contactId, status: { in: ["skipped", "done"] } },
      orderBy: { created_at: "desc" },
      take: SKIP_PENALTY_WINDOW,
      select: { status: true },
    }),
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { interest_decayed_at: true, last_goal_event_at: true },
    }),
  ]);

  const skips = recentFollowUps.filter((f) => f.status === "skipped").length;

  return {
    openGoalCount: openGoals,
    lastGoalMentionedAt: lastMention?.last_mentioned_at ?? null,
    lastGoalSatisfiedAt: lastSatisfied?.satisfied_at ?? null,
    recentSkipsOrDeclines: skips,
    decayedAt: contact?.interest_decayed_at ?? new Date(),
    lastGoalEventAt: contact?.last_goal_event_at ?? null,
  };
}

function decideTier(opts: {
  currentTier: InterestTier;
  score: number;
  openGoalCount: number;
  lastGoalEventAt: Date | null;
}): InterestTier {
  // Upward: any new goal or strong score → active immediately.
  if (opts.openGoalCount > 0 || opts.score >= ACTIVE_RECOVER) {
    return "active";
  }

  const quietDays = daysAgo(opts.lastGoalEventAt);

  if (
    opts.score < DORMANT_THRESHOLD &&
    quietDays >= DORMANT_QUIET_DAYS
  ) {
    return "dormant";
  }

  if (
    opts.score < ACTIVE_THRESHOLD &&
    opts.openGoalCount === 0 &&
    quietDays >= MAINTENANCE_QUIET_DAYS
  ) {
    return "maintenance";
  }

  return opts.currentTier;
}

const TIER_LABELS: Record<InterestTier, string> = {
  active: "active (еженедельный режим)",
  maintenance: "maintenance (раз в месяц)",
  dormant: "dormant (раз в квартал)",
};

const TIER_RANK: Record<InterestTier, number> = {
  active: 0,
  maintenance: 1,
  dormant: 2,
};

function isDowngrade(from: InterestTier, to: InterestTier): boolean {
  return TIER_RANK[to] > TIER_RANK[from];
}

/**
 * Recalculate interest_score and (unless tier_locked) auto-transition the tier.
 *
 * Upward transitions (e.g. → active when a new goal pops up) apply silently.
 * Downward transitions (active → maintenance / maintenance → dormant) also
 * apply automatically but create a follow-up so the user is notified and
 * can revert with one tap.
 */
export async function recalcAndAutoInterestTier(contactId: string): Promise<void> {
  const inputs = await loadScoreInputs(contactId);
  const score = computeInterestScore(inputs);

  await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      select: {
        full_name: true,
        interest_tier: true,
        tier_locked: true,
      },
    });
    if (!contact) return;

    const currentTier = (contact.interest_tier as InterestTier) ?? "active";

    let nextTier = currentTier;
    if (!contact.tier_locked) {
      nextTier = decideTier({
        currentTier,
        score,
        openGoalCount: inputs.openGoalCount,
        lastGoalEventAt: inputs.lastGoalEventAt,
      });
    }

    await tx.contact.update({
      where: { id: contactId },
      data: {
        interest_score: score,
        interest_tier: nextTier,
        interest_decayed_at: new Date(),
      },
    });

    if (nextTier !== currentTier) {
      await tx.interaction.create({
        data: {
          contact_id: contactId,
          type: "note",
          content: `[auto] interest tier: ${currentTier} → ${nextTier}`,
        },
      });

      if (isDowngrade(currentTier, nextTier)) {
        // Notify the user so the change is visible — single-tap revert via UI.
        await tx.followUp.create({
          data: {
            contact_id: contactId,
            suggested_action: `Перевёл ${contact.full_name} в режим «${TIER_LABELS[nextTier]}» — все цели закрыты, активный интерес угас. Вернуть в active?`,
            due_date: new Date(),
            priority: 4,
          },
        });
      }
    }
  });
}

/**
 * Daily decay step — applies the half-life decay to interest_score for every
 * unlocked contact and bumps interest_decayed_at to "now". Cheap bulk SQL.
 */
export async function applyInterestDecay(): Promise<void> {
  // Postgres-side multiplicative decay using the seconds since interest_decayed_at.
  // Equivalent to: score *= exp(-ln2 / 30 * days_since_last_decay)
  await prisma.$executeRawUnsafe(
    `UPDATE "Contact"
       SET "interest_score" = GREATEST(0, LEAST(100,
             "interest_score" * EXP(-${DECAY_RATE} * EXTRACT(EPOCH FROM (NOW() - "interest_decayed_at")) / 86400)
           )),
           "interest_decayed_at" = NOW()
     WHERE "tier_locked" = FALSE`,
  );
}

/**
 * For each unlocked contact, recompute score and apply tier transitions.
 * Called from the daily cron after applyInterestDecay.
 */
export async function evaluateInterestTiers(): Promise<void> {
  const ids = await prisma.contact.findMany({
    where: {
      tier_locked: false,
      warmth_status: { not: "archived" },
    },
    select: { id: true },
  });

  for (const { id } of ids) {
    try {
      await recalcAndAutoInterestTier(id);
    } catch {
      // Skip individual failures so one bad contact doesn't kill the cron.
    }
  }
}

/** Mark an open goal as satisfied (or abandoned) and refresh the contact. */
export async function setGoalStatus(
  goalId: string,
  status: "satisfied" | "abandoned",
  satisfiedByInteractionId?: string | null,
): Promise<void> {
  const goal = await prisma.interestGoal.findUnique({
    where: { id: goalId },
    select: { contact_id: true, status: true },
  });
  if (!goal) return;
  if (goal.status === status) return;

  await prisma.interestGoal.update({
    where: { id: goalId },
    data: {
      status,
      satisfied_at: status === "satisfied" ? new Date() : null,
      satisfied_by_interaction_id:
        status === "satisfied" ? satisfiedByInteractionId ?? null : null,
    },
  });

  await prisma.contact.update({
    where: { id: goal.contact_id },
    data: { last_goal_event_at: new Date() },
  });

  await recalcAndAutoInterestTier(goal.contact_id);
}

/**
 * Create a new open goal on a contact. Dedupes against existing open goals
 * by case-insensitive substring match — if one is already there, just bump
 * its last_mentioned_at instead.
 */
export async function addOrTouchGoal(
  contactId: string,
  description: string,
  source: "ai" | "user" | "synergy_backfill" = "ai",
): Promise<{ created: boolean; goalId: string }> {
  const trimmed = description.trim();
  if (!trimmed) return { created: false, goalId: "" };

  const existing = await prisma.interestGoal.findMany({
    where: { contact_id: contactId, status: "open" },
    select: { id: true, description: true },
  });

  const norm = trimmed.toLowerCase();
  const dup = existing.find((g) => {
    const a = g.description.toLowerCase();
    return a === norm || a.includes(norm) || norm.includes(a);
  });

  if (dup) {
    await prisma.interestGoal.update({
      where: { id: dup.id },
      data: { last_mentioned_at: new Date() },
    });
    await prisma.contact.update({
      where: { id: contactId },
      data: { last_goal_event_at: new Date() },
    });
    return { created: false, goalId: dup.id };
  }

  const goal = await prisma.interestGoal.create({
    data: {
      contact_id: contactId,
      description: trimmed,
      source,
    },
    select: { id: true },
  });

  await prisma.contact.update({
    where: { id: contactId },
    data: { last_goal_event_at: new Date() },
  });

  await recalcAndAutoInterestTier(contactId);
  return { created: true, goalId: goal.id };
}

/** Public helper for external callers (manual UI tier change). */
export async function applyManualTierChange(
  contactId: string,
  tier: InterestTier,
): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data: { interest_tier: tier, tier_locked: true },
  });
  await prisma.interaction.create({
    data: {
      contact_id: contactId,
      type: "note",
      content: `[user] interest tier set to ${tier} (locked)`,
    },
  });
}

/** Release the manual lock so the cron can manage tier again. */
export async function unlockTier(contactId: string): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data: { tier_locked: false },
  });
}
