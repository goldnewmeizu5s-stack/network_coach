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
  where_met: string | null;
  occupation: string | null;
  potential_synergies: string | null;
  last_interaction_at: Date | null;
  created_at: Date;
  pendingCount: number;
  skippedCount: number;
  doneCount: number;
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

/** Build a contextual hook from available contact data for richer action text. */
function contextHook(c: ContactWithCounts): string {
  if (c.potential_synergies) return ` Идея: ${c.potential_synergies}`;
  if (c.key_interests.length > 0) return ` Тема: ${c.key_interests[0]}`;
  if (c.where_met) return ` Вы познакомились: ${c.where_met}`;
  if (c.occupation) return ` (${c.occupation})`;
  return "";
}

/** Build a topic hint for content-sharing actions. */
function topicHint(c: ContactWithCounts): string {
  if (c.key_interests.length > 0) {
    const interest = c.key_interests[
      Math.floor(Math.random() * c.key_interests.length)
    ];
    return ` по теме «${interest}»`;
  }
  if (c.occupation) return ` по работе (${c.occupation})`;
  return "";
}

/**
 * Generate follow-up drafts from pre-loaded contact data.
 * No DB queries — all data is passed in.
 *
 * Key design decisions:
 * - new/warming: split into "never contacted" (use created_at) vs "has interacted" (use last_interaction_at)
 * - warm: only 0–30 day window matters (cron decays warm→cooling at 30 days)
 * - cooling: graduated escalation by time + skip-count based pause suggestions
 * - paused: two-tier reassessment (60d review, 180d archive suggestion)
 * - NO time-window gaps — every contact eventually gets a follow-up
 */
export function generateFollowUps(contact: ContactWithCounts): FollowUpDraft[] {
  // Hard limit: never spam with too many pending follow-ups
  if (contact.pendingCount >= 3) return [];

  switch (contact.warmth_status) {
    case "new":
    case "warming":
      return generateNewWarmingFollowUps(contact);
    case "warm":
      return generateWarmFollowUps(contact);
    case "cooling":
      return generateCoolingFollowUps(contact);
    case "paused":
      return generatePausedFollowUps(contact);
    default:
      return [];
  }
}

/**
 * New / Warming contacts — establish the relationship.
 *
 * Two distinct paths:
 * A) Never contacted (last_interaction_at is null) → urgency grows with days since creation
 * B) Has been contacted → use daysSinceLastInteraction for deepening steps
 */
function generateNewWarmingFollowUps(contact: ContactWithCounts): FollowUpDraft[] {
  if (contact.pendingCount > 0) return [];

  const drafts: FollowUpDraft[] = [];
  const name = contact.full_name;
  const hook = contextHook(contact);
  const topic = topicHint(contact);
  const neverContacted = contact.last_interaction_at === null;

  if (neverContacted) {
    const daysSinceCreated = daysAgo(contact.created_at);

    if (daysSinceCreated >= 1 && daysSinceCreated < 3) {
      // Fresh contact — gentle nudge
      drafts.push({
        contact_id: contact.id,
        suggested_action: `Отправь ${name} сообщение «приятно познакомиться».${hook}`,
        due_date: addDays(0),
        priority: 8,
      });
    } else if (daysSinceCreated >= 3 && daysSinceCreated < 7) {
      // First impression fading — escalated
      drafts.push({
        contact_id: contact.id,
        suggested_action: `Первое впечатление остывает — напиши ${name} сейчас, пока помнят.${hook}`,
        due_date: addDays(0),
        priority: 9,
      });
    } else if (daysSinceCreated >= 7 && daysSinceCreated < 21) {
      // Week+ without any contact — direct
      drafts.push({
        contact_id: contact.id,
        suggested_action: `${Math.round(daysSinceCreated)} дн. с добавления ${name} — напиши или реши, нужен ли контакт.${hook}`,
        due_date: addDays(0),
        priority: 7,
      });
    } else if (daysSinceCreated >= 21) {
      // 3+ weeks — ultimatum
      drafts.push({
        contact_id: contact.id,
        suggested_action: `${name} добавлен(а) ${Math.round(daysSinceCreated)} дн. назад, но ты так и не написал(а). Напиши или заархивируй.`,
        due_date: addDays(0),
        priority: 6,
      });
    }
  } else {
    // Has been contacted — build on the relationship
    const daysSinceInteraction = daysAgo(contact.last_interaction_at);

    if (daysSinceInteraction >= 5 && daysSinceInteraction < 12) {
      // Share value — cement the connection
      drafts.push({
        contact_id: contact.id,
        suggested_action: `Поделись чем-то полезным с ${name}${topic} (статья, ресурс, контакт).`,
        due_date: addDays(1),
        priority: 6,
      });
    } else if (daysSinceInteraction >= 12 && daysSinceInteraction < 21) {
      // Deepen — propose meeting
      drafts.push({
        contact_id: contact.id,
        suggested_action: `Предложи ${name} встречу за кофе или звонок — закрепи знакомство.${hook}`,
        due_date: addDays(1),
        priority: 7,
      });
    } else if (daysSinceInteraction >= 21) {
      // 3 weeks silence — warning
      drafts.push({
        contact_id: contact.id,
        suggested_action: `Три недели без контакта с ${name}. Напиши что-нибудь простое, не теряй связь.${hook}`,
        due_date: addDays(0),
        priority: 8,
      });
    }
  }

  return drafts;
}

/**
 * Warm contacts — maintain the relationship.
 *
 * The cron decays warm → cooling at 30 days without interaction,
 * so the relevant window is 0–30 days. Old code had a 42–57 day
 * window that was unreachable dead code — removed.
 */
function generateWarmFollowUps(contact: ContactWithCounts): FollowUpDraft[] {
  if (contact.pendingCount > 0) return [];

  const drafts: FollowUpDraft[] = [];
  const daysSince = daysAgo(contact.last_interaction_at);
  const name = contact.full_name;
  const topic = topicHint(contact);

  if (daysSince >= 14 && daysSince < 22) {
    // Two weeks — light touch
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Лёгкое касание: отреагируй на контент ${name} или отправь полезную ссылку${topic}.`,
      due_date: addDays(2),
      priority: 4,
    });
  } else if (daysSince >= 22) {
    // Approaching the 30-day cooling threshold — warn with countdown
    const daysLeft = Math.max(1, 30 - Math.round(daysSince));
    drafts.push({
      contact_id: contact.id,
      suggested_action: `${name} скоро начнёт остывать (~${daysLeft} дн). Предложи встречу или напиши${topic}.`,
      due_date: addDays(0),
      priority: 6,
    });
  }

  return drafts;
}

/**
 * Cooling contacts — re-engage or help decide to pause/archive.
 *
 * Three layers:
 * 1) Skip-based: if user keeps skipping, suggest pausing (not guilt-trip)
 * 2) Time-based graduated escalation: light → medium → urgent
 * 3) Context hooks from contact data for actionable suggestions
 */
function generateCoolingFollowUps(contact: ContactWithCounts): FollowUpDraft[] {
  if (contact.pendingCount > 0) return [];

  const drafts: FollowUpDraft[] = [];
  const daysSince = daysAgo(contact.last_interaction_at);
  const daysText = Math.round(daysSince);
  const name = contact.full_name;
  const hook = contextHook(contact);

  // Skip-count escalation — respect the user's behaviour pattern
  if (contact.skippedCount >= 3) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Ты ${contact.skippedCount} раз откладывал(а) ${name}. Честно: поставить на паузу или заархивировать?`,
      due_date: addDays(0),
      priority: 3,
    });
    return drafts;
  }
  if (contact.skippedCount >= 2) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Уже дважды откладывал(а) ${name}. Может, стоит поставить на паузу?`,
      due_date: addDays(0),
      priority: 5,
    });
    return drafts;
  }

  // Time-based graduated escalation
  if (daysSince < 45) {
    // Recent cooling — light reconnection
    drafts.push({
      contact_id: contact.id,
      suggested_action: `${name} остывает (${daysText} дн). Лёгкое касание: отреагируй на пост или отправь ссылку.${hook}`,
      due_date: addDays(0),
      priority: 6,
    });
  } else if (daysSince < 75) {
    // Mid cooling — needs real effort
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Связь с ${name} слабеет (${daysText} дн). Напиши личное сообщение — не шаблон.${hook}`,
      due_date: addDays(0),
      priority: 7,
    });
  } else {
    // Long cooling — last chance
    drafts.push({
      contact_id: contact.id,
      suggested_action: `${daysText} дн. без контакта с ${name}. Сейчас или никогда: напиши или поставь на паузу.${hook}`,
      due_date: addDays(0),
      priority: 8,
    });
  }

  return drafts;
}

/**
 * Paused contacts — periodic reassessment.
 *
 * Two tiers:
 * - 60+ days: suggest reviewing their social media, maybe resume
 * - 180+ days: suggest archiving if still no interest
 */
function generatePausedFollowUps(contact: ContactWithCounts): FollowUpDraft[] {
  if (contact.pendingCount > 0) return [];

  const drafts: FollowUpDraft[] = [];
  const daysSince = daysAgo(contact.last_interaction_at);
  const name = contact.full_name;

  if (daysSince >= 180) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `${name} на паузе уже ${Math.round(daysSince)} дн. Заархивировать или есть причина возобновить?`,
      due_date: addDays(1),
      priority: 2,
    });
  } else if (daysSince >= 60) {
    drafts.push({
      contact_id: contact.id,
      suggested_action: `Переоценка: посмотри соцсети ${name}, чем занимается. Стоит ли возобновить?`,
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
      where_met: true,
      occupation: true,
      potential_synergies: true,
      last_interaction_at: true,
      created_at: true,
    },
  });
  if (!contact) return [];

  const [pendingCount, skippedCount, doneCount] = await Promise.all([
    prisma.followUp.count({
      where: { contact_id: contactId, status: "pending" },
    }),
    prisma.followUp.count({
      where: { contact_id: contactId, status: "skipped" },
    }),
    prisma.followUp.count({
      where: { contact_id: contactId, status: "done" },
    }),
  ]);

  return generateFollowUps({
    ...contact,
    where_met: contact.where_met ?? null,
    occupation: contact.occupation ?? null,
    potential_synergies: contact.potential_synergies ?? null,
    pendingCount,
    skippedCount,
    doneCount,
  });
}
