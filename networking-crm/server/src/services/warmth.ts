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

export function getAllowedTransitions(currentStatus: string): string[] {
  return VALID_TRANSITIONS[currentStatus] || [];
}

export function isValidTransition(from: string, to: string): boolean {
  return getAllowedTransitions(from).includes(to);
}

export async function calculateWarmthScore(contactId: string): Promise<number> {
  const interactions = await prisma.interaction.findMany({
    where: { contact_id: contactId, type: { in: SCORING_TYPES } },
    select: {
      type: true,
      created_at: true,
      audio_file: { select: { duration_seconds: true } },
    },
    orderBy: { created_at: "desc" },
  });

  const completedFollowUps = await prisma.followUp.count({
    where: { contact_id: contactId, status: "done" },
  });

  // Base: interactions count × 10
  const interactionBonus = Math.min(interactions.length * 10, 40);

  // Recency bonus
  let recencyBonus = 0;
  if (interactions.length > 0) {
    const lastDate = interactions[0].created_at;
    const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) recencyBonus = 30;
    else if (daysSince < 14) recencyBonus = 20;
    else if (daysSince < 30) recencyBonus = 10;
  }

  // Depth bonus
  let depthBonus = 0;
  if (interactions.some((i) => i.type === "meeting")) depthBonus += 20;
  if (
    interactions.some(
      (i) =>
        i.type === "voice_note" &&
        i.audio_file &&
        (i.audio_file.duration_seconds ?? 0) > 180
    )
  )
    depthBonus += 10;
  depthBonus += Math.min(completedFollowUps * 15, 45);

  return Math.min(interactionBonus + recencyBonus + depthBonus, 100);
}

export async function recalcAndAutoStatus(contactId: string): Promise<void> {
  const score = await calculateWarmthScore(contactId);
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { warmth_status: true },
  });
  if (!contact) return;

  let newStatus = contact.warmth_status;

  // Count only meaningful interactions for auto-transitions
  const interactionCount = await prisma.interaction.count({
    where: { contact_id: contactId, type: { in: SCORING_TYPES } },
  });

  if (contact.warmth_status === "new" && interactionCount >= 2) {
    newStatus = "warming";
  } else if (contact.warmth_status === "warming" && interactionCount >= 3) {
    newStatus = "warm";
  } else if (contact.warmth_status === "cooling") {
    const recentMeaningful = await prisma.interaction.count({
      where: {
        contact_id: contactId,
        type: { in: ["meeting", "message", "follow_up"] },
        created_at: { gte: new Date(Date.now() - 7 * 86400000) },
      },
    });
    if (recentMeaningful > 0) {
      newStatus = "warming";
    }
  }

  const data: Record<string, unknown> = { warmth_score: score };
  if (newStatus !== contact.warmth_status) {
    data.warmth_status = newStatus;
    await prisma.interaction.create({
      data: {
        contact_id: contactId,
        type: "note",
        content: `[auto] Status changed from ${contact.warmth_status} to ${newStatus}`,
      },
    });
  }

  await prisma.contact.update({ where: { id: contactId }, data });
}
