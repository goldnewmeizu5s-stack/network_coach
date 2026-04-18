import prisma from "../lib/prisma";

const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ["warming", "paused", "archived"],
  warming: ["warm", "paused", "archived", "new"],
  warm: ["cooling", "paused", "archived"],
  cooling: ["warming", "paused", "archived"],
  paused: ["new", "archived"],
  archived: ["new"],
};

// Only these types count toward warmth scoring
const SCORING_TYPES = ["voice_note", "follow_up", "meeting", "message"];

// Points per interaction type — higher-effort actions worth more
const INTERACTION_POINTS: Record<string, number> = {
  meeting: 15,
  voice_note: 10,
  follow_up: 8,
  message: 5,
};

// Score decays by half every 14 days without new interactions
const HALF_LIFE_DAYS = 14;
const DECAY_RATE = Math.LN2 / HALF_LIFE_DAYS;

// Score thresholds for auto status transitions
const THRESHOLD_WARMING = 20;
const THRESHOLD_WARM = 50;
const THRESHOLD_RECOVER = 35;

export function getAllowedTransitions(currentStatus: string): string[] {
  return VALID_TRANSITIONS[currentStatus] || [];
}

export function isValidTransition(from: string, to: string): boolean {
  return getAllowedTransitions(from).includes(to);
}

// Score ranges that the progress bar should fall into for each status.
// Keeps the visual bar consistent with the status badge after a manual change.
const STATUS_SCORE_RANGE: Record<string, [number, number]> = {
  new: [0, THRESHOLD_WARMING - 1],
  warming: [THRESHOLD_WARMING, THRESHOLD_WARM - 1],
  warm: [THRESHOLD_WARM, 100],
  cooling: [THRESHOLD_RECOVER, THRESHOLD_WARM - 1],
  paused: [0, 100],
  archived: [0, 100],
};

export function alignScoreToStatus(score: number, status: string): number {
  const range = STATUS_SCORE_RANGE[status];
  if (!range) return score;
  const [min, max] = range;
  return Math.min(Math.max(score, min), max);
}

export async function calculateWarmthScore(contactId: string): Promise<number> {
  const interactions = await prisma.interaction.findMany({
    where: { contact_id: contactId, type: { in: SCORING_TYPES } },
    select: { type: true, created_at: true },
    orderBy: { created_at: "desc" },
  });

  const [completedFollowUps, totalFollowUps] = await Promise.all([
    prisma.followUp.count({ where: { contact_id: contactId, status: "done" } }),
    prisma.followUp.count({ where: { contact_id: contactId } }),
  ]);

  const now = Date.now();

  // ── 1. Time-decayed interaction score (0-60) ──────────────────────
  // Each interaction contributes weighted points that decay exponentially.
  // Recent meeting = ~15 pts, same meeting 14 days later = ~7.5 pts.
  let decayedSum = 0;
  for (const interaction of interactions) {
    const daysSince =
      (now - interaction.created_at.getTime()) / (1000 * 60 * 60 * 24);
    const base = INTERACTION_POINTS[interaction.type] ?? 5;
    decayedSum += base * Math.exp(-DECAY_RATE * daysSince);
  }
  const interactionScore = Math.min(Math.round(decayedSum), 60);

  // ── 2. Consistency bonus (0-20) ──────────────────────────────────
  // Rewards regular contact cadence; penalises sporadic bursts.
  // Uses coefficient of variation (CV) of gaps between interactions.
  let consistencyScore = 0;
  if (interactions.length >= 3) {
    const ts = interactions.map((i) => i.created_at.getTime());
    const gaps: number[] = [];
    for (let i = 0; i < ts.length - 1; i++) {
      gaps.push((ts[i] - ts[i + 1]) / (1000 * 60 * 60 * 24));
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avg > 0) {
      const variance =
        gaps.reduce((a, b) => a + (b - avg) ** 2, 0) / gaps.length;
      const cv = Math.sqrt(variance) / avg;
      // cv → 0 = perfectly regular → 20 pts
      // cv → 1 = irregular → ~10 pts
      // cv → 2+ = very chaotic → ~5 pts
      consistencyScore = Math.round(20 * Math.exp(-0.7 * cv));
    } else {
      consistencyScore = 5; // all on the same day
    }
  } else if (interactions.length === 2) {
    consistencyScore = 5;
  }

  // ── 3. Follow-up reliability bonus (0-15) ────────────────────────
  // Completion rate × 10  +  min(completed × 2, 5)
  let followUpScore = 0;
  if (totalFollowUps > 0) {
    const rate = completedFollowUps / totalFollowUps;
    followUpScore = Math.min(
      Math.round(rate * 10 + Math.min(completedFollowUps * 2, 5)),
      15,
    );
  }

  // ── 4. Variety bonus (0-5) ───────────────────────────────────────
  // Using multiple interaction types signals a richer relationship.
  const uniqueTypes = new Set(interactions.map((i) => i.type));
  const varietyScore = Math.min(Math.round(uniqueTypes.size * 1.5), 5);

  return Math.min(
    interactionScore + consistencyScore + followUpScore + varietyScore,
    100,
  );
}

export async function recalcAndAutoStatus(contactId: string): Promise<void> {
  const score = await calculateWarmthScore(contactId);

  await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      select: { warmth_status: true },
    });
    if (!contact) return;

    let newStatus = contact.warmth_status;

    // Score-based auto-transitions (only upward; downward needs a cron)
    if (contact.warmth_status === "new" && score >= THRESHOLD_WARMING) {
      newStatus = "warming";
    } else if (
      contact.warmth_status === "warming" &&
      score >= THRESHOLD_WARM
    ) {
      newStatus = "warm";
    } else if (
      contact.warmth_status === "cooling" &&
      score >= THRESHOLD_RECOVER
    ) {
      newStatus = "warming";
    }

    const data: Record<string, unknown> = { warmth_score: score };
    if (newStatus !== contact.warmth_status) {
      data.warmth_status = newStatus;
      await tx.interaction.create({
        data: {
          contact_id: contactId,
          type: "note",
          content: `[auto] Status changed from ${contact.warmth_status} to ${newStatus}`,
        },
      });
    }

    await tx.contact.update({ where: { id: contactId }, data });
  });
}

/** Apply a user/bot-initiated status change.
 *  Recomputes the interaction-based score, then clamps it into the range
 *  that matches the new status so the progress bar reflects the badge. */
export async function applyManualStatusChange(
  contactId: string,
  newStatus: string,
): Promise<void> {
  const calculated = await calculateWarmthScore(contactId);
  const aligned = alignScoreToStatus(calculated, newStatus);
  await prisma.contact.update({
    where: { id: contactId },
    data: { warmth_status: newStatus, warmth_score: aligned },
  });
}
