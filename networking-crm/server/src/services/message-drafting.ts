import { anthropic } from "../lib/ai";
import { config } from "../config";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { HUMANIZATION_RULES, HUMANIZATION_RULES_SHORT } from "./humanization-prompt";

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

${HUMANIZATION_RULES}

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
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      user,
      overdueFollowUps,
      recentInteractions,
      mostNeglected,
      newContacts,
      contactsWithSynergies,
      statusCounts,
    ] = await Promise.all([
      // User goals and context
      prisma.user.findFirst({
        select: { goals: true, strengths: true, weaknesses: true },
      }),

      // Overdue follow-ups with contact context
      prisma.followUp.findMany({
        where: { status: "pending", due_date: { lte: now } },
        select: {
          suggested_action: true,
          due_date: true,
          priority: true,
          contact: { select: { full_name: true, occupation: true, key_interests: true } },
        },
        orderBy: { priority: "desc" },
        take: 3,
      }),

      // Recent interactions (last 7 days) to understand activity patterns
      prisma.interaction.findMany({
        where: { created_at: { gte: sevenDaysAgo } },
        select: {
          type: true,
          ai_summary: true,
          created_at: true,
          contact: { select: { full_name: true } },
        },
        orderBy: { created_at: "desc" },
        take: 5,
      }),

      // Most neglected contacts (with rich context)
      prisma.contact.findMany({
        where: {
          warmth_status: { in: ["cooling", "warm"] },
          last_interaction_at: { not: null },
        },
        select: {
          full_name: true,
          occupation: true,
          company: true,
          key_interests: true,
          potential_synergies: true,
          what_impressed_me: true,
          where_met: true,
          warmth_status: true,
          last_interaction_at: true,
          relationship_category: true,
        },
        orderBy: { last_interaction_at: "asc" },
        take: 3,
      }),

      // New contacts needing nurturing
      prisma.contact.findMany({
        where: { warmth_status: "new" },
        select: {
          full_name: true,
          occupation: true,
          key_interests: true,
          where_met: true,
          what_impressed_me: true,
          created_at: true,
        },
        orderBy: { created_at: "desc" },
        take: 3,
      }),

      // Contacts with potential synergies
      prisma.contact.findMany({
        where: {
          potential_synergies: { not: null },
          warmth_status: { in: ["new", "warming", "warm", "cooling"] },
        },
        select: {
          full_name: true,
          potential_synergies: true,
          key_interests: true,
          warmth_status: true,
        },
        take: 5,
      }),

      // Contact counts by status
      prisma.contact.groupBy({
        by: ["warmth_status"],
        _count: true,
      }),
    ]);

    const statusMap = Object.fromEntries(
      statusCounts.map((s) => [s.warmth_status, s._count])
    );

    const daysSince = (date: Date | null) => {
      if (!date) return null;
      return Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
    };

    // Build rich context for the AI
    const sections: string[] = [];

    // User profile
    if (user?.goals || user?.strengths || user?.weaknesses) {
      const profile = [
        user.goals && `Goals: ${user.goals}`,
        user.strengths && `Strengths: ${user.strengths}`,
        user.weaknesses && `Growth areas: ${user.weaknesses}`,
      ].filter(Boolean);
      sections.push(`USER PROFILE:\n${profile.join("\n")}`);
    }

    // Network overview
    sections.push(
      `NETWORK: ${Object.entries(statusMap).map(([s, c]) => `${s}: ${c}`).join(", ")}`
    );

    // Activity this week
    if (recentInteractions.length > 0) {
      const activity = recentInteractions.map((i) =>
        `- ${i.type} with ${i.contact?.full_name || "unknown"} (${daysSince(i.created_at)}d ago)${i.ai_summary ? `: ${i.ai_summary.slice(0, 100)}` : ""}`
      ).join("\n");
      sections.push(`RECENT ACTIVITY (last 7 days):\n${activity}`);
    } else {
      sections.push("RECENT ACTIVITY: No interactions in the last 7 days.");
    }

    // Overdue follow-ups
    if (overdueFollowUps.length > 0) {
      const fups = overdueFollowUps.map((f) =>
        `- ${f.contact.full_name}${f.contact.occupation ? ` (${f.contact.occupation})` : ""}: "${f.suggested_action}" (overdue ${daysSince(f.due_date)}d, priority ${f.priority}/10)`
      ).join("\n");
      sections.push(`OVERDUE FOLLOW-UPS:\n${fups}`);
    }

    // Most neglected contacts
    if (mostNeglected.length > 0) {
      const neglected = mostNeglected.map((c) => {
        const details = [
          c.occupation && `works as ${c.occupation}`,
          c.company && `at ${c.company}`,
          c.where_met && `met at ${c.where_met}`,
          c.key_interests.length > 0 && `interests: ${c.key_interests.join(", ")}`,
          c.potential_synergies && `synergy: ${c.potential_synergies}`,
          c.what_impressed_me && `impressed you: ${c.what_impressed_me}`,
        ].filter(Boolean).join("; ");
        return `- ${c.full_name} (${c.warmth_status}, last contact ${daysSince(c.last_interaction_at)}d ago): ${details}`;
      }).join("\n");
      sections.push(`MOST NEGLECTED:\n${neglected}`);
    }

    // New contacts
    if (newContacts.length > 0) {
      const nc = newContacts.map((c) => {
        const details = [
          c.occupation && `${c.occupation}`,
          c.where_met && `met at ${c.where_met}`,
          c.key_interests.length > 0 && `interests: ${c.key_interests.join(", ")}`,
          c.what_impressed_me && `impressed you: ${c.what_impressed_me}`,
        ].filter(Boolean).join("; ");
        return `- ${c.full_name} (added ${daysSince(c.created_at)}d ago): ${details}`;
      }).join("\n");
      sections.push(`NEW CONTACTS:\n${nc}`);
    }

    // Synergy opportunities
    const synergyPairs = findSynergyOpportunities(contactsWithSynergies);
    if (synergyPairs.length > 0) {
      sections.push(`POTENTIAL CONNECTIONS:\n${synergyPairs.join("\n")}`);
    }

    const context = sections.join("\n\n");

    const prompt = `You are an expert networking strategist and relationship coach. Analyze the user's CRM data below and produce ONE high-value, non-obvious insight in Russian.

${context}

INSIGHT TYPES (pick the most impactful one for today):
1. SYNERGY ALERT — two contacts who should meet each other, or a contact who can help with the user's goals
2. TIMING INSIGHT — a contact worth reaching out to NOW based on their work, interests, or how long it's been
3. RELATIONSHIP PATTERN — an observation about the user's networking habits (e.g. neglecting a category, not following up)
4. STRATEGIC MOVE — a specific action tied to the user's goals that leverages an existing contact
5. RECONNECTION HOOK — a creative, non-generic reason to reach out to a neglected contact (based on their interests/work, NOT just "давно не общались")

RULES:
- Write 2-3 sentences in Russian, conversational tone
- Be SPECIFIC: use names, occupations, interests, synergies — whatever makes the insight feel personal and non-generic
- The insight must be something the user couldn't figure out by just looking at a contact list
- Suggest a CONCRETE next step (not "напиши сообщение", but what specifically to write about or propose)
- Never guilt-trip, be encouraging and strategic
- Do NOT start with generic phrases like "У тебя есть контакт..." or "Обрати внимание..."

${HUMANIZATION_RULES_SHORT}`;

    const message = await anthropic.messages.create({
      model: config.claudeFastModel,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    return message.content[0].type === "text"
      ? message.content[0].text
      : getFallbackInsight(statusMap["cooling"] ?? 0, overdueFollowUps.length);
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

function findSynergyOpportunities(
  contacts: { full_name: string; potential_synergies: string | null; key_interests: string[]; warmth_status: string }[]
): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i];
      const b = contacts[j];
      const sharedInterests = a.key_interests.filter((int) =>
        b.key_interests.some((bi) => bi.toLowerCase() === int.toLowerCase())
      );
      if (sharedInterests.length > 0) {
        pairs.push(`- ${a.full_name} & ${b.full_name} share interests: ${sharedInterests.join(", ")}`);
      }
    }
  }
  return pairs.slice(0, 3);
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

${HUMANIZATION_RULES_SHORT}

Write ONE short sentence in Russian. Reference specific details. Keep it actionable.`;

    const message = await anthropic.messages.create({
      model: config.claudeFastModel,
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

${HUMANIZATION_RULES_SHORT}

${itemDescriptions}

Return a JSON array with exactly ${items.length} strings, one per item in the same order.
Example format: ["personalized text 1", "personalized text 2", ...]`;

  try {
    const message = await anthropic.messages.create({
      model: config.claudeFastModel,
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
