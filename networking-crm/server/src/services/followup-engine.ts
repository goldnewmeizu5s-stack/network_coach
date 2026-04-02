import prisma from "../lib/prisma";

interface FollowUpDraft {
  contact_id: string;
  suggested_action: string;
  due_date: Date;
  priority: number;
}

/** Pre-loaded contact data with counts — no DB queries inside. */
export interface ContactWithCounts {
  id: string;
  full_name: string;
  warmth_status: string;
  key_interests: string[];
  last_interaction_at: Date | null;
  created_at: Date;
  pendingCount: number;
  skippedCount: number;
}

function daysAgo(date: Date | null | undefined): number {
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Generate follow-up drafts from pre-loaded contact data.
 * No DB queries — all data is passed in.
 */
export function generateFollowUps(contact: ContactWithCounts): FollowUpDraft[] {
  const { pendingCount, skippedCount } = contact;

  // Don't generate if there are already 3+ pending
  if (pendingCount >= 3) return [];

  const daysSinceCreated = daysAgo(contact.created_at);
  const daysSinceLastInteraction = daysAgo(contact.last_interaction_at);

  switch (contact.warmth_status) {
    case "new":
    case "warming":
      return generateNewContactFollowUps(contact, daysSinceCreated, pendingCount);
    case "warm":
      return generateWarmFollowUps(contact, daysSinceLastInteraction, pendingCount);
    case "cooling":
      return generateCoolingFollowUps(contact, daysSinceLastInteraction, skippedCount, pendingCount);
    case "paused":
      return generatePausedFollowUps(contact, daysSinceLastInteraction, pendingCount);
    default:
      return [];
  }
}

function generateNewContactFollowUps(
  contact: { id: string; full_name: string },
  daysSinceCreated: number,
  pendingCount: number
): FollowUpDraft[] {
  const drafts: FollowUpDraft[] = [];
  if (pendingCount > 0) return drafts;

  if (daysSinceCreated < 3) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Отправь ${contact.full_name} сообщение "приятно познакомиться"`,
      due_date: addDays(1),
      priority: 8,
    });
  } else if (daysSinceCreated >= 5 && daysSinceCreated < 8) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Поделись чем-то полезным с ${contact.full_name} (статья, ресурс, контакт)`,
      due_date: addDays(1),
      priority: 6,
    });
  } else if (daysSinceCreated >= 14 && daysSinceCreated < 22) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Предложи ${contact.full_name} встречу за кофе или звонок`,
      due_date: addDays(1),
      priority: 7,
    });
  }

  return drafts;
}

function generateWarmFollowUps(
  contact: { id: string; full_name: string },
  daysSinceLastInteraction: number,
  pendingCount: number
): FollowUpDraft[] {
  const drafts: FollowUpDraft[] = [];
  if (pendingCount > 0) return drafts;

  if (daysSinceLastInteraction >= 21 && daysSinceLastInteraction < 29) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Лёгкое касание: отреагируй на контент ${contact.full_name} или отправь полезную ссылку`,
      due_date: addDays(1),
      priority: 4,
    });
  } else if (daysSinceLastInteraction >= 42 && daysSinceLastInteraction < 57) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Предложи ${contact.full_name} встречу или звонок — давно не общались`,
      due_date: addDays(1),
      priority: 6,
    });
  }

  return drafts;
}

function generateCoolingFollowUps(
  contact: { id: string; full_name: string; key_interests: string[] },
  daysSinceLastInteraction: number,
  skippedCount: number,
  pendingCount: number
): FollowUpDraft[] {
  const drafts: FollowUpDraft[] = [];
  if (pendingCount > 0) return drafts;

  const daysText = Math.round(daysSinceLastInteraction);
  const interestHint =
    contact.key_interests.length > 0
      ? ` Обсуди тему: ${contact.key_interests[0]}`
      : "";

  if (skippedCount >= 2) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Ты уже дважды откладывал(а) связь с ${contact.full_name}. Может, стоит поставить на паузу?`,
      due_date: addDays(0),
      priority: 5,
    });
  } else {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Внимание: ты не общался(ась) с ${contact.full_name} уже ${daysText} дней.${interestHint}`,
      due_date: addDays(0),
      priority: 8,
    });
  }

  return drafts;
}

function generatePausedFollowUps(
  contact: { id: string; full_name: string },
  daysSinceLastInteraction: number,
  pendingCount: number
): FollowUpDraft[] {
  const drafts: FollowUpDraft[] = [];
  if (pendingCount > 0) return drafts;

  if (daysSinceLastInteraction >= 60) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Переоценка: посмотри соцсети ${contact.full_name}, чем занимается. Стоит ли возобновить?`,
      due_date: addDays(1),
      priority: 3,
    });
  }

  return drafts;
}

/**
 * Convenience wrapper: loads contact + counts from DB, then generates drafts.
 * Used by the /api/followups/generate route (single contact).
 */
export async function generateFollowUpsForContact(
  contactId: string
): Promise<FollowUpDraft[]> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      full_name: true,
      warmth_status: true,
      key_interests: true,
      last_interaction_at: true,
      created_at: true,
    },
  });
  if (!contact) return [];

  const [pendingCount, skippedCount] = await Promise.all([
    prisma.followUp.count({
      where: { contact_id: contactId, status: "pending" },
    }),
    prisma.followUp.count({
      where: { contact_id: contactId, status: "skipped" },
    }),
  ]);

  return generateFollowUps({ ...contact, pendingCount, skippedCount });
}
