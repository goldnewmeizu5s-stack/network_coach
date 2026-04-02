import prisma from "../lib/prisma";

interface FollowUpDraft {
  contact_id: string;
  suggested_action: string;
  due_date: Date;
  priority: number;
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

export async function generateFollowUps(
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

  // Get existing pending follow-ups to avoid duplicates
  const pendingCount = await prisma.followUp.count({
    where: { contact_id: contactId, status: "pending" },
  });

  // Get skipped count for cooling contacts
  const skippedCount = await prisma.followUp.count({
    where: { contact_id: contactId, status: "skipped" },
  });

  const daysSinceCreated = daysAgo(contact.created_at);
  const daysSinceLastInteraction = daysAgo(contact.last_interaction_at);
  const drafts: FollowUpDraft[] = [];

  // Don't generate if there are already 3+ pending
  if (pendingCount >= 3) return [];

  switch (contact.warmth_status) {
    case "new":
      drafts.push(...generateNewContactFollowUps(contact, daysSinceCreated, pendingCount));
      break;
    case "warming":
      drafts.push(...generateNewContactFollowUps(contact, daysSinceCreated, pendingCount));
      break;
    case "warm":
      drafts.push(...generateWarmFollowUps(contact, daysSinceLastInteraction, pendingCount));
      break;
    case "cooling":
      drafts.push(...generateCoolingFollowUps(contact, daysSinceLastInteraction, skippedCount, pendingCount));
      break;
    case "paused":
      drafts.push(...generatePausedFollowUps(contact, daysSinceLastInteraction, pendingCount));
      break;
  }

  return drafts;
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
