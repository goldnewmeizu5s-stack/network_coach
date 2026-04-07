import { anthropic } from "../lib/ai";
import { config } from "../config";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";

const TONE_GUIDE: Record<string, string> = {
  new: 'Formal but friendly. Style: "Было приятно познакомиться на [event]...", "Рад(а) знакомству..."',
  warming:
    'Casual and friendly. Style: "Привет! Вспомнил(а) о тебе, когда увидел(а)...", "Как дела? Слушай..."',
  warm: 'Free-form, like friends. Style: "Слушай, давно не виделись...", "Привет! У меня идея..."',
  cooling:
    'Gentle reconnection. Style: "Привет! Давно не общались, как дела?", "Соскучился(ась)! Как ты?"',
  paused: 'Warm re-introduction. Style: "Привет! Давно не на связи были..."',
};

function buildContactContext(contact: NonNullable<Awaited<ReturnType<typeof loadFullContact>>>) {
  const info = [
    `Name: ${contact.full_name}`,
    contact.nickname && `Nickname: ${contact.nickname}`,
    contact.occupation && `Occupation: ${contact.occupation}`,
    contact.company && `Company: ${contact.company}`,
    contact.city && `City: ${contact.city}`,
    contact.where_met && `Where we met: ${contact.where_met}`,
    contact.key_interests.length > 0 &&
      `Interests: ${contact.key_interests.join(", ")}`,
    contact.what_impressed_me &&
      `What impressed me: ${contact.what_impressed_me}`,
    contact.potential_synergies &&
      `Potential synergies: ${contact.potential_synergies}`,
    contact.personality_notes &&
      `Personality notes: ${contact.personality_notes}`,
    contact.memory_summary && `Summary: ${contact.memory_summary}`,
    contact.memory_notes?.length > 0 &&
      `Memory hooks: ${contact.memory_notes.join(" | ")}`,
    contact.personal_notes && `Personal notes: ${contact.personal_notes}`,
    contact.relationship_category &&
      `Category: ${contact.relationship_category}`,
  ]
    .filter(Boolean)
    .join("\n");

  const interactions = contact.interactions
    .map((i) => {
      const date = new Date(i.created_at).toLocaleDateString();
      const text = i.transcript || i.ai_summary || i.content || "(no content)";
      return `[${date}] ${i.type}: ${text}`;
    })
    .join("\n");

  const followUps = contact.follow_ups
    .map((f) => `[${f.status}] ${f.suggested_action}`)
    .join("\n");

  return { info, interactions, followUps };
}

async function loadFullContact(contactId: string) {
  return prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      interactions: {
        orderBy: { created_at: "desc" },
        take: 20,
        select: {
          type: true,
          content: true,
          transcript: true,
          ai_summary: true,
          created_at: true,
        },
      },
      follow_ups: {
        orderBy: { created_at: "desc" },
        take: 10,
        select: {
          suggested_action: true,
          status: true,
        },
      },
    },
  });
}

function safeParseJsonArray(text: string): string[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 5).map(String);
    }
  } catch {
    // Try to extract JSON array from text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed.slice(0, 5).map(String);
      } catch {
        // give up
      }
    }
  }
  return null;
}

export async function draftFollowUpMessage(
  contactId: string,
  action: string
): Promise<string[]> {
  const contact = await loadFullContact(contactId);
  if (!contact) throw new Error("Contact not found");

  const ctx = buildContactContext(contact);
  const tone = TONE_GUIDE[contact.warmth_status] || TONE_GUIDE.warming;

  const prompt = `You are helping the user write a follow-up message to someone they know.

Contact info:
${ctx.info}

Interaction history:
${ctx.interactions || "(no interactions yet)"}

Past follow-ups:
${ctx.followUps || "(none)"}

Requested action: ${action}
Current warmth level: ${contact.warmth_status}

Tone guide for this warmth level: ${tone}

Generate 3 short message options (2-4 sentences each) that are:
- Natural and human, not robotic or generic
- Reference something SPECIFIC from the notes about this person (interests, where you met, what impressed you)
- Match the tone guide above for the current warmth level
- Written in the same language as the user's notes about this person

Return as JSON array of 3 strings: ["message1", "message2", "message3"]`;

  try {
    const message = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "[]";

    const parsed = safeParseJsonArray(text);
    if (parsed && parsed.length > 0) return parsed.slice(0, 3);
    return [text];
  } catch (err) {
    logger.error("Claude API error in message drafting", { error: String(err) });
    // Fallback templates
    return generateFallbackMessages(contact.full_name, action, contact.warmth_status);
  }
}

export interface Suggestion {
  action: string;
  reasoning: string;
  urgency: "low" | "medium" | "high";
  timeframe: string;
}

export async function suggestActions(contactId: string): Promise<Suggestion[]> {
  const contact = await loadFullContact(contactId);
  if (!contact) throw new Error("Contact not found");

  const ctx = buildContactContext(contact);

  const daysSince = contact.last_interaction_at
    ? Math.round(
        (Date.now() - new Date(contact.last_interaction_at).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  // Load user goals
  const user = await prisma.user.findFirst({
    select: { goals: true },
  });

  const prompt = `Analyze this contact and their interaction history, then suggest 3-5 specific next actions.

Contact:
${ctx.info}

Interactions:
${ctx.interactions || "(none)"}

Past follow-ups:
${ctx.followUps || "(none)"}

Current warmth: ${contact.warmth_status}
Days since last contact: ${daysSince ?? "never contacted"}

${user?.goals ? `User's networking goals: ${user.goals}` : ""}

For each action, provide:
- action: what to do (specific, referencing their interests/context)
- reasoning: why this makes sense now (1 sentence)
- urgency: low/medium/high
- timeframe: when to do it (e.g. "this week", "in 2 days")

Return as JSON array of objects with fields: action, reasoning, urgency, timeframe.
Be specific — reference actual details from the contact profile.
Write in the same language as the contact's notes.`;

  try {
    const message = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "[]";

    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as Suggestion[];
      return parsed.slice(0, 5);
    }
    return [];
  } catch (err) {
    logger.error("Claude API error in suggest-actions", { error: String(err) });
    return getFallbackSuggestions(contact.full_name, contact.warmth_status);
  }
}

export async function generateDailyInsight(): Promise<string> {
  try {
    const coolingContacts = await prisma.contact.findMany({
      where: { warmth_status: "cooling" },
      select: { full_name: true, key_interests: true },
      take: 5,
    });

    const newContacts = await prisma.contact.count({
      where: { warmth_status: "new" },
    });

    const pendingFollowUps = await prisma.followUp.count({
      where: { status: "pending" },
    });

    const warmContacts = await prisma.contact.count({
      where: { warmth_status: "warm" },
    });

    const stats = [
      `Cooling contacts: ${coolingContacts.length}`,
      coolingContacts.length > 0 &&
        `Names: ${coolingContacts.map((c) => `${c.full_name} (interests: ${c.key_interests.join(", ") || "none"})`).join("; ")}`,
      `New contacts: ${newContacts}`,
      `Warm contacts: ${warmContacts}`,
      `Pending follow-ups: ${pendingFollowUps}`,
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = `You are a personal networking coach. Based on the user's CRM stats, write ONE short, actionable insight (1-2 sentences in Russian). Be specific — mention names and interests where relevant.

Stats:
${stats}

Rules:
- Be encouraging, not guilt-tripping
- Reference specific contacts and their interests
- Suggest one concrete action
- Keep it under 2 sentences
- Write in Russian`;

    const message = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    return message.content[0].type === "text"
      ? message.content[0].text
      : getFallbackInsight(coolingContacts.length, pendingFollowUps);
  } catch (err) {
    logger.error("Claude API error in daily insight", { error: String(err) });
    const cooling = await prisma.contact.count({
      where: { warmth_status: "cooling" },
    });
    const pending = await prisma.followUp.count({
      where: { status: "pending" },
    });
    return getFallbackInsight(cooling, pending);
  }
}

export async function personalizeFollowUpText(
  contactName: string,
  templateAction: string,
  contactInterests: string[],
  whereMet: string | null
): Promise<string> {
  try {
    const context = [
      contactInterests.length > 0 && `Interests: ${contactInterests.join(", ")}`,
      whereMet && `Where met: ${whereMet}`,
    ]
      .filter(Boolean)
      .join(". ");

    const prompt = `Rewrite this follow-up action to be more personal and specific.

Template: "${templateAction}"
Contact name: ${contactName}
${context ? `Context: ${context}` : ""}

Write ONE short sentence in Russian. Reference specific details. Keep it actionable.`;

    const message = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text.trim() : "";
    return text || templateAction;
  } catch {
    return templateAction;
  }
}

export interface BatchPersonalizeItem {
  index: number;
  contactName: string;
  templateAction: string;
  contactInterests: string[];
  whereMet: string | null;
}

/**
 * Personalize multiple follow-up texts in a single Claude API call.
 * Returns a map from index to personalized text. Items not in the result
 * keep their template text.
 */
export async function batchPersonalizeFollowUps(
  items: BatchPersonalizeItem[]
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (items.length === 0) return result;

  const itemDescriptions = items.map((item, i) => {
    const context = [
      item.contactInterests.length > 0 && `Interests: ${item.contactInterests.join(", ")}`,
      item.whereMet && `Where met: ${item.whereMet}`,
    ]
      .filter(Boolean)
      .join(". ");

    return `[${i}] Contact: ${item.contactName}${context ? ` | ${context}` : ""}
Template: "${item.templateAction}"`;
  }).join("\n\n");

  const prompt = `Rewrite each follow-up action below to be more personal and specific.
For each item, write ONE short sentence in Russian. Reference specific details from the context. Keep it actionable.

${itemDescriptions}

Return a JSON array with exactly ${items.length} strings, one per item in the same order.
Example format: ["personalized text 1", "personalized text 2", ...]`;

  try {
    const message = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: items.length * 150,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        for (let i = 0; i < Math.min(parsed.length, items.length); i++) {
          const personalized = String(parsed[i]).trim();
          if (personalized) {
            result.set(items[i].index, personalized);
          }
        }
      }
    }
  } catch (err) {
    logger.error("Claude API error in batch personalization", { error: String(err) });
  }

  return result;
}

// Fallback functions

function generateFallbackMessages(
  name: string,
  action: string,
  warmth: string
): string[] {
  const greetings: Record<string, string[]> = {
    new: [
      `Привет, ${name}! Было приятно познакомиться. ${action}`,
      `${name}, рад(а) знакомству! Хотел(а) написать по поводу: ${action}`,
      `Добрый день, ${name}! Пишу, потому что: ${action}`,
    ],
    warming: [
      `Привет, ${name}! ${action}`,
      `${name}, как дела? ${action}`,
      `Привет! Вспомнил(а) о тебе. ${action}`,
    ],
    warm: [
      `${name}, привет! ${action}`,
      `Слушай, ${name}! ${action}`,
      `${name}! ${action}`,
    ],
    cooling: [
      `Привет, ${name}! Давно не общались. ${action}`,
      `${name}, как ты? ${action}`,
      `Привет! Давно не на связи были. ${action}`,
    ],
  };
  return greetings[warmth] || greetings.warming;
}

function getFallbackSuggestions(name: string, warmth: string): Suggestion[] {
  const base: Suggestion[] = [
    {
      action: `Отправь ${name} короткое сообщение`,
      reasoning: "Поддержание связи важно для нетворкинга",
      urgency: warmth === "cooling" ? "high" : "medium",
      timeframe: "на этой неделе",
    },
    {
      action: `Посмотри профиль ${name} в соцсетях`,
      reasoning: "Узнай, чем занимается, чтобы найти тему для разговора",
      urgency: "low",
      timeframe: "в ближайшие дни",
    },
  ];
  return base;
}

function getFallbackInsight(
  coolingCount: number,
  pendingCount: number
): string {
  if (coolingCount > 0) {
    return `У тебя ${coolingCount} контакт(ов) остывают. Начни с одного — отправь короткое сообщение.`;
  }
  if (pendingCount > 0) {
    return `${pendingCount} follow-up(ов) ждут твоего внимания. Выбери самый важный и начни с него!`;
  }
  return "Отличная работа! Сеть в порядке. Может, записать голосовое о новом знакомстве?";
}
