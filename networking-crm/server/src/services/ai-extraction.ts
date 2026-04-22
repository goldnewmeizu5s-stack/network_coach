import { anthropic, cachedSystem } from "../lib/ai";
import { config } from "../config";
import prisma from "../lib/prisma";
import { ExtractedContact, MultiExtractionResult, FollowUpSuggestion, BatchActivityResult, ActivitySegment } from "../types";
import { logger } from "../lib/logger";
import { normalizeCountry, normalizeCountryKeepRaw } from "../lib/country-normalize";

async function loadUserContextForExtraction(): Promise<string> {
  try {
    const user = await prisma.user.findFirst();
    if (!user) return "";
    const prefs = (user.preferences as Record<string, unknown>) || {};
    const navigatorPrompt = prefs.navigator_prompt as string | undefined;
    const parts: string[] = [];
    if (user.current_country) {
      const iso = normalizeCountry(user.current_country) || user.current_country;
      parts.push(
        `The user is currently in ${iso}. When the transcript does not specify where a meeting happened, default met_country to ${iso}.`,
      );
    }
    if (navigatorPrompt) parts.push(`--- USER CONTEXT ---\n${navigatorPrompt}`);
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

function buildExtractionTail(userContext: string): string {
  const todayStr = new Date().toISOString().slice(0, 10);
  return [`Today is ${todayStr}.`, userContext].filter(Boolean).join("\n\n");
}

const SYSTEM_PROMPT = `You are analyzing a voice note or text message where the user describes someone they just met or wants to update information about an existing contact.

Extract the following into structured JSON (use null for unknown fields):
{
  "full_name": "string or null",
  "nickname": "string or null",
  "where_met": "event, location, context or null (do NOT include time references like '2 месяца назад' here — put timing into met_date)",
  "met_date": "ISO 8601 date string (YYYY-MM-DD) when the meeting took place, or null. If the user mentions a relative time like '2 месяца назад', 'неделю назад', 'вчера', 'на прошлой неделе', 'в январе', calculate the actual date relative to today's date. Today's date is provided at the end of this system prompt.",
  "occupation": "short role description or null",
  "company": "string or null",
  "city": "string or null",
  "country": "string or null",
  "met_country": "ISO 3166-1 alpha-2 country code (e.g. 'AE', 'RU', 'US') — country where the meeting/interaction took place, or null",
  "origin_country": "ISO 3166-1 alpha-2 country code (e.g. 'RU', 'UA', 'DE') — country the person is originally from / their nationality, or null",
  "key_interests": ["array of interests"],
  "what_impressed_me": "what the user found interesting or null",
  "potential_synergies": "how this person could be valuable and vice versa or null",
  "personality_notes": "vibe, energy, communication style or null",
  "suggested_next_steps": [
    {
      "action": "specific, actionable follow-up task",
      "due_days": 3,
      "reason": "brief explanation why this action and why this timing"
    }
  ],
  "urgency_score": 5,
  "relationship_category": "business|friendship|mentor|connector|investor|creative|other",
  "memory_summary": "short portrait of this person",
  "memory_hook": "one tiny personal detail to remember — the kind of thing that makes you 'their person'",
  "is_update": false,
  "follow_up_questions": ["question1", "question2"]
}

STYLE for memory_hook (VERY IMPORTANT):
- Extract ONE tiny, personal, memorable detail about this person — something most people would forget
- This is the kind of detail that, when you remember it months later, makes the person feel truly seen
- Examples: "любит горький шоколад Lindt 85% — отец привозил из командировок", "собака Рекс болеет", "мечтает переехать в Лиссабон", "не пьёт кофе, только матча", "дочка идёт в первый класс в сентябре"
- Keep it SHORT — one sentence max, like a sticky note to yourself
- Focus on: personal stories, family details, habits, dreams, health, pets, food preferences, emotional moments
- Do NOT repeat what's already in memory_summary — this is about the HUMAN side, not the professional side
- If nothing personal was mentioned, return null — don't force it

STYLE for memory_summary (VERY IMPORTANT):
- Write 2-4 SHORT sentences. No fluff, no "beautiful words", no filler.
- Follow this formula: character/vibe -> achievement/fact -> current activity -> context/what's next
- Use concrete numbers, not "many" or "significant" — write "$200M", "5 years", etc.
- Minimal adjectives. Every sentence = a new thought. No repetition.
- DON'T write: "очень талантливый и амбициозный специалист"
- DO write: "тихий, но по факту сильный. кофаундер проекта с оценкой $200M. сейчас делает ИИ-агента для трейдинга. завтра идем на хайкинг"
- Write in lowercase, casual but dense with facts. Like a telegram to yourself.

RULES for suggested_next_steps:
- Each step is an object with "action" (what to do), "due_days" (days from now), and "reason" (why)
- NEVER suggest something the user already plans to do. If they say "we're meeting tomorrow" or "going hiking together" — that meeting is ALREADY happening, don't create a follow-up for it
- Instead, think about what should happen AFTER the planned event
- due_days should be SMART: if a meeting is tomorrow, the follow-up should be in 2-3 days (after the meeting). If no meeting planned, follow up in 1-2 days while the connection is fresh
- Generate 1-3 follow-ups. Each should be a DIFFERENT type of action
- Each step is an ACTION, not a thought. Not "понять его", but "сходить на хайкинг и расспросить про крипто-проект"
- Write steps short and concrete. No generic "stay in touch" or "get to know better"

RULES for follow_up_questions:
- If the description is missing CRITICAL information, generate 1-3 short direct questions to ask the user
- Critical fields to check: full_name (MOST important — always ask if missing), occupation/what they do, where_met
- Do NOT ask about optional fields like company, city, interests, personality — only ask about truly important gaps
- Keep questions short, casual, and conversational. Write in the same language as the input
- If you have enough info (at least a name), return an empty array []
- Examples: "Как его/её зовут?", "Чем занимается?", "Где познакомились?"

Other rules:
- If the user speaks in Russian, write ALL text fields in Russian
- If the transcript doesn't describe a person, set "is_update" to null and return all other fields as null
- Return ONLY valid JSON, no markdown, no explanation`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function extractContactData(
  transcript: string
): Promise<ExtractedContact> {
  const maxRetries = 2;
  const backoff = [2000, 6000];

  const userContext = await loadUserContextForExtraction();
  const system = cachedSystem(SYSTEM_PROMPT, buildExtractionTail(userContext));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: transcript }],
      });

      let text =
        message.content[0]?.type === "text" ? message.content[0].text : "";

      // Strip markdown code blocks if AI wraps JSON in ```json ... ```
      text = text.trim();
      if (text.startsWith("```")) {
        text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }

      const parsed = JSON.parse(text) as ExtractedContact;

      // Validate & normalize
      return {
        full_name: parsed.full_name ?? null,
        nickname: parsed.nickname ?? null,
        where_met: parsed.where_met ?? null,
        occupation: parsed.occupation ?? null,
        company: parsed.company ?? null,
        city: parsed.city ?? null,
        country: normalizeCountryKeepRaw(parsed.country),
        met_country: normalizeCountry(parsed.met_country),
        origin_country: normalizeCountry(parsed.origin_country),
        key_interests: Array.isArray(parsed.key_interests)
          ? parsed.key_interests
          : [],
        what_impressed_me: parsed.what_impressed_me ?? null,
        potential_synergies: parsed.potential_synergies ?? null,
        personality_notes: parsed.personality_notes ?? null,
        suggested_next_steps: normalizeFollowUps(parsed.suggested_next_steps),
        urgency_score:
          typeof parsed.urgency_score === "number"
            ? Math.min(10, Math.max(1, parsed.urgency_score))
            : 5,
        relationship_category: parsed.relationship_category ?? "other",
        memory_summary: parsed.memory_summary ?? null,
        memory_hook: parsed.memory_hook ?? null,
        met_date: typeof parsed.met_date === "string" ? parsed.met_date : null,
        is_update: parsed.is_update ?? null,
        follow_up_questions: Array.isArray(parsed.follow_up_questions)
          ? parsed.follow_up_questions.filter((q: unknown) => typeof q === "string")
          : [],
      };
    } catch (err: unknown) {
      const isLast = attempt === maxRetries - 1;
      if (isLast) throw err;

      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`AI extraction attempt ${attempt + 1} failed, retrying`, { delay: backoff[attempt] });
      await sleep(backoff[attempt]);
    }
  }

  throw new Error("AI extraction failed after all retries");
}

const MULTI_PERSON_PROMPT = `You are analyzing a voice note or text message where the user describes ONE OR MULTIPLE people they just met or wants to update information about existing contacts.

The user may describe several people in a single recording. Your job is to detect ALL mentioned people and extract structured data for EACH of them separately.

Return a JSON object with the following structure:
{
  "is_voice_note": false,
  "contacts": [
    {
      "full_name": "string or null",
      "nickname": "string or null",
      "where_met": "event, location, context or null (do NOT include time references like '2 месяца назад' here — put timing into met_date)",
      "met_date": "ISO 8601 date string (YYYY-MM-DD) when the meeting took place, or null. If the user mentions a relative time like '2 месяца назад', 'неделю назад', 'вчера', 'на прошлой неделе', 'в январе', calculate the actual date relative to today's date. Today's date is provided at the end of this system prompt.",
      "occupation": "short role description or null",
      "company": "string or null",
      "city": "string or null",
      "country": "string or null",
      "met_country": "ISO 3166-1 alpha-2 country code (e.g. 'AE', 'RU', 'US') — country where the meeting/interaction took place, or null",
      "origin_country": "ISO 3166-1 alpha-2 country code (e.g. 'RU', 'UA', 'DE') — country the person is originally from / their nationality, or null",
      "key_interests": ["array of interests"],
      "what_impressed_me": "what the user found interesting or null",
      "potential_synergies": "how this person could be valuable and vice versa or null",
      "personality_notes": "vibe, energy, communication style or null",
      "suggested_next_steps": [
        {
          "action": "specific, actionable follow-up task",
          "due_days": 3,
          "reason": "brief explanation why this action and why this timing"
        }
      ],
      "urgency_score": 5,
      "relationship_category": "business|friendship|mentor|connector|investor|creative|other",
      "memory_summary": "short portrait of this person",
      "memory_hook": "one tiny personal detail to remember",
      "is_update": false,
      "follow_up_questions": []
    }
  ]
}

STYLE for memory_hook (VERY IMPORTANT):
- Extract ONE tiny, personal, memorable detail about this person — something most people would forget
- This is the kind of detail that, when you remember it months later, makes the person feel truly seen
- Examples: "любит горький шоколад Lindt 85% — отец привозил из командировок", "собака Рекс болеет", "мечтает переехать в Лиссабон", "не пьёт кофе, только матча"
- Keep it SHORT — one sentence max, like a sticky note to yourself
- Focus on: personal stories, family details, habits, dreams, health, pets, food preferences, emotional moments
- Do NOT repeat what's already in memory_summary — this is about the HUMAN side, not the professional side
- If nothing personal was mentioned, return null

IMPORTANT RULES:
- If the transcript mentions MULTIPLE people, create a SEPARATE entry in the "contacts" array for EACH person
- Each person gets their own full extraction with all fields
- If common context applies (e.g. met at the same event), include it for each person separately
- If the transcript doesn't describe any person at all, set "is_voice_note" to true and return an empty "contacts" array
- If only one person is mentioned, return a "contacts" array with a single element

STYLE for memory_summary (VERY IMPORTANT):
- Write 2-4 SHORT sentences. No fluff, no "beautiful words", no filler.
- Follow this formula: character/vibe -> achievement/fact -> current activity -> context/what's next
- Use concrete numbers, not "many" or "significant" — write "$200M", "5 years", etc.
- Minimal adjectives. Every sentence = a new thought. No repetition.
- DON'T write: "очень талантливый и амбициозный специалист"
- DO write: "тихий, но по факту сильный. кофаундер проекта с оценкой $200M. сейчас делает ИИ-агента для трейдинга. завтра идем на хайкинг"
- Write in lowercase, casual but dense with facts. Like a telegram to yourself.

RULES for suggested_next_steps:
- Each step is an object with "action" (what to do), "due_days" (days from now), and "reason" (why)
- NEVER suggest something the user already plans to do. If they say "we're meeting tomorrow" or "going hiking together" — that meeting is ALREADY happening, don't create a follow-up for it
- Instead, think about what should happen AFTER the planned event
- due_days should be SMART: if a meeting is tomorrow, the follow-up should be in 2-3 days (after the meeting). If no meeting planned, follow up in 1-2 days while the connection is fresh
- Generate 1-3 follow-ups per person. Each should be a DIFFERENT type of action
- Each step is an ACTION, not a thought. Not "понять его", but "сходить на хайкинг и расспросить про крипто-проект"
- Write steps short and concrete. No generic "stay in touch" or "get to know better"

RULES for follow_up_questions:
- If a person's description is missing CRITICAL information, generate 1-3 short direct questions
- Critical fields: full_name (MOST important), occupation/what they do, where_met
- Do NOT ask about optional fields like company, city, interests, personality
- Keep questions short, casual, and conversational. Write in the same language as the input
- If you have enough info (at least a name), return an empty array []

Other rules:
- If the user speaks in Russian, write ALL text fields in Russian
- Return ONLY valid JSON, no markdown, no explanation`;

export async function extractMultipleContacts(
  transcript: string
): Promise<MultiExtractionResult> {
  const maxRetries = 2;
  const backoff = [2000, 6000];

  const userContext = await loadUserContextForExtraction();
  const system = cachedSystem(MULTI_PERSON_PROMPT, buildExtractionTail(userContext));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: transcript }],
      });

      let text =
        message.content[0]?.type === "text" ? message.content[0].text : "";

      text = text.trim();
      if (text.startsWith("```")) {
        text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }

      const parsed = JSON.parse(text) as { is_voice_note?: boolean; contacts?: unknown[] };

      const isVoiceNote = parsed.is_voice_note === true;
      const rawContacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];

      const contacts: ExtractedContact[] = rawContacts.map((raw: unknown) => {
        const p = raw as Record<string, unknown>;
        return {
          full_name: (p.full_name as string) ?? null,
          nickname: (p.nickname as string) ?? null,
          where_met: (p.where_met as string) ?? null,
          occupation: (p.occupation as string) ?? null,
          company: (p.company as string) ?? null,
          city: (p.city as string) ?? null,
          country: normalizeCountryKeepRaw(p.country),
          met_country: normalizeCountry(p.met_country),
          origin_country: normalizeCountry(p.origin_country),
          key_interests: Array.isArray(p.key_interests) ? p.key_interests : [],
          what_impressed_me: (p.what_impressed_me as string) ?? null,
          potential_synergies: (p.potential_synergies as string) ?? null,
          personality_notes: (p.personality_notes as string) ?? null,
          suggested_next_steps: normalizeFollowUps(p.suggested_next_steps),
          urgency_score:
            typeof p.urgency_score === "number"
              ? Math.min(10, Math.max(1, p.urgency_score))
              : 5,
          relationship_category: (p.relationship_category as string) ?? "other",
          memory_summary: (p.memory_summary as string) ?? null,
          memory_hook: (p.memory_hook as string) ?? null,
          met_date: typeof p.met_date === "string" ? (p.met_date as string) : null,
          is_update: p.is_update === true ? true : p.is_update === false ? false : null,
          follow_up_questions: Array.isArray(p.follow_up_questions)
            ? (p.follow_up_questions as unknown[]).filter((q): q is string => typeof q === "string")
            : [],
        };
      });

      return { contacts, is_voice_note: isVoiceNote || contacts.length === 0 };
    } catch (err: unknown) {
      const isLast = attempt === maxRetries - 1;
      if (isLast) throw err;

      logger.warn(`Multi-extraction attempt ${attempt + 1} failed, retrying`, { delay: backoff[attempt] });
      await sleep(backoff[attempt]);
    }
  }

  throw new Error("Multi-person AI extraction failed after all retries");
}

// --- Batch Activity Extraction ---

const BATCH_ACTIVITY_PROMPT = `You are analyzing a long voice note (5-10 minutes) where the user describes their recent networking activity — what happened with various contacts over the past days/weeks.

The user will talk about MULTIPLE people in a single recording: who they met, what they discussed, what follow-ups they need to do, new people they met, etc.

You are given the user's EXISTING CONTACTS list at the end of this system prompt. Your job is to:
1. Identify every person mentioned in the transcript
2. Match them to existing contacts (by name, nickname, company, context — be smart about matching "Ваня" to "Иван Петров", "Маша из Яндекса" to "Мария Иванова" at Яндекс, etc.)
3. If someone is clearly NEW (not in the existing contacts list), mark them as new
4. For EACH person, extract what happened, what was discussed, what outcomes there were, and what follow-ups are needed

Return a JSON object:
{
  "is_valid": true,
  "overall_summary": "краткое описание всего голосового: сколько людей упомянуто, основные темы",
  "segments": [
    {
      "contact_name": "имя как в существующих контактах, или как назвал пользователь если новый",
      "matched_contact_id": "uuid существующего контакта или null если новый",
      "is_new_contact": false,
      "interaction_type": "meeting|message|voice_note|follow_up|note",
      "activity_summary": "что произошло с этим человеком — краткий, но содержательный пересказ",
      "topics_discussed": ["тема1", "тема2"],
      "outcomes": ["договорились о...", "он прислал...", "решили что..."],
      "suggested_next_steps": [
        {
          "action": "конкретное действие",
          "due_days": 3,
          "reason": "почему именно это и почему в эти сроки"
        }
      ],
      "urgency_score": 7,
      "relationship_category": "business|friendship|mentor|connector|investor|creative|other",
      "warmth_change": "improved|stable|declined",
      "warmth_reason": "почему отношения улучшились/ухудшились/стабильны",
      "memory_hook": "одна маленькая личная деталь, которую стоит запомнить, или null",
      "memory_notes": ["факт 1", "факт 2"],
      "contact_data": null
    }
  ]
}

RULES for matching contacts:
- Match by name similarity: "Ваня" = "Иван", "Саша" = "Александр", "Лёша" = "Алексей", etc.
- Match by context: if user says "Маша из Яндекса" and there's a contact "Мария Сидорова" at company "Яндекс" — it's a match
- Match by nickname if exists
- If you're NOT SURE about a match, set matched_contact_id to null and is_new_contact to false — the system will ask the user
- For NEW contacts, set is_new_contact to true and fill contact_data with all available info

RULES for contact_data (only for NEW contacts):
- Fill in: full_name, nickname, where_met, occupation, company, city, country, met_country, origin_country, key_interests, what_impressed_me, potential_synergies, personality_notes, memory_summary, memory_hook, relationship_category, urgency_score, met_date
- Use null for unknown fields
- For met_date, calculate from relative dates. Today's date is provided at the end of this system prompt.

RULES for interaction_type:
- "meeting" — if they met in person (кофе, обед, мероприятие, встреча)
- "message" — if they communicated via text (написал, переписывались, отправил)
- "follow_up" — if user completed a planned follow-up action
- "note" — general update, thinking about the person, plans

RULES for activity_summary:
- Write dense, factual, 2-4 sentences
- Include: what happened, where, key topics, any agreements or outcomes
- No fluff, no filler words
- Write in the same language as the input

RULES for suggested_next_steps:
- 0-3 per person
- ONLY suggest what the user HASN'T already done or planned
- due_days should be smart: urgent stuff = 1-2 days, regular follow-ups = 3-7 days, low priority = 7-14 days
- Each step is concrete and actionable

RULES for warmth_change:
- "improved" — meaningful positive interaction happened (met, had good conversation, helped each other)
- "stable" — light touch, brief exchange, no significant change
- "declined" — negative signal (ignored, conflict, ghosted, user expressed doubt)

RULES for memory_hook:
- ONE tiny personal detail worth remembering
- The kind of thing that makes you "their person" when you remember it months later
- null if nothing personal was mentioned

RULES for memory_notes:
- New facts learned about this person from this activity
- Can be professional or personal
- Short bullet-point style

Other rules:
- If the user speaks in Russian, write ALL text fields in Russian
- If the transcript doesn't describe any networking activity, set is_valid to false and return empty segments
- Return ONLY valid JSON, no markdown, no explanation`;

export interface ContactForMatching {
  id: string;
  full_name: string;
  nickname: string | null;
  occupation: string | null;
  company: string | null;
  city: string | null;
  warmth_status: string;
}

export async function extractBatchActivity(
  transcript: string,
  existingContacts: ContactForMatching[]
): Promise<BatchActivityResult> {
  const maxRetries = 2;
  const backoff = [2000, 6000];

  const todayStr = new Date().toISOString().slice(0, 10);
  const contactsList = existingContacts
    .map(
      (c) =>
        `- ID: ${c.id} | ${c.full_name}${c.nickname ? ` (${c.nickname})` : ""}${c.occupation ? ` — ${c.occupation}` : ""}${c.company ? ` @ ${c.company}` : ""}${c.city ? `, ${c.city}` : ""} [${c.warmth_status}]`
    )
    .join("\n");

  const userContext = await loadUserContextForExtraction();
  const tail = [
    `Today is ${todayStr}.`,
    `EXISTING CONTACTS:\n${contactsList || "(no existing contacts)"}`,
    userContext,
  ]
    .filter(Boolean)
    .join("\n\n");
  const system = cachedSystem(BATCH_ACTIVITY_PROMPT, tail);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: transcript }],
      });

      let text =
        message.content[0]?.type === "text" ? message.content[0].text : "";

      text = text.trim();
      if (text.startsWith("```")) {
        text = text
          .replace(/^```(?:json)?\s*\n?/, "")
          .replace(/\n?```\s*$/, "");
      }

      const parsed = JSON.parse(text) as Record<string, unknown>;

      const isValid = parsed.is_valid !== false;
      const overallSummary =
        typeof parsed.overall_summary === "string"
          ? parsed.overall_summary
          : "";
      const rawSegments = Array.isArray(parsed.segments)
        ? parsed.segments
        : [];

      const segments: ActivitySegment[] = rawSegments.map(
        (raw: unknown) => {
          const s = raw as Record<string, unknown>;
          return {
            contact_name: (s.contact_name as string) ?? "Unknown",
            matched_contact_id: (s.matched_contact_id as string) ?? null,
            is_new_contact: s.is_new_contact === true,
            interaction_type: validateInteractionType(
              s.interaction_type as string
            ),
            activity_summary: (s.activity_summary as string) ?? "",
            topics_discussed: Array.isArray(s.topics_discussed)
              ? (s.topics_discussed as string[])
              : [],
            outcomes: Array.isArray(s.outcomes)
              ? (s.outcomes as string[])
              : [],
            suggested_next_steps: normalizeFollowUps(s.suggested_next_steps),
            urgency_score:
              typeof s.urgency_score === "number"
                ? Math.min(10, Math.max(1, s.urgency_score))
                : 5,
            relationship_category:
              (s.relationship_category as string) ?? "other",
            warmth_change: validateWarmthChange(s.warmth_change as string),
            warmth_reason: (s.warmth_reason as string) ?? "",
            memory_hook: (s.memory_hook as string) ?? null,
            memory_notes: Array.isArray(s.memory_notes)
              ? (s.memory_notes as string[])
              : [],
            contact_data: s.is_new_contact === true
              ? normalizeContactData(s.contact_data)
              : null,
          };
        }
      );

      return { is_valid: isValid, segments, overall_summary: overallSummary };
    } catch (err: unknown) {
      const isLast = attempt === maxRetries - 1;
      if (isLast) throw err;

      logger.warn(
        `Batch activity extraction attempt ${attempt + 1} failed, retrying`,
        { delay: backoff[attempt] }
      );
      await sleep(backoff[attempt]);
    }
  }

  throw new Error("Batch activity extraction failed after all retries");
}

function validateInteractionType(
  type: string
): ActivitySegment["interaction_type"] {
  const valid = ["meeting", "message", "voice_note", "follow_up", "note"];
  return valid.includes(type)
    ? (type as ActivitySegment["interaction_type"])
    : "note";
}

function validateWarmthChange(
  change: string
): "improved" | "stable" | "declined" {
  const valid = ["improved", "stable", "declined"];
  return valid.includes(change)
    ? (change as "improved" | "stable" | "declined")
    : "stable";
}

function normalizeContactData(
  raw: unknown
): Partial<ExtractedContact> | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  return {
    full_name: (p.full_name as string) ?? null,
    nickname: (p.nickname as string) ?? null,
    where_met: (p.where_met as string) ?? null,
    occupation: (p.occupation as string) ?? null,
    company: (p.company as string) ?? null,
    city: (p.city as string) ?? null,
    country: normalizeCountryKeepRaw(p.country),
    met_country: normalizeCountry(p.met_country),
    origin_country: normalizeCountry(p.origin_country),
    key_interests: Array.isArray(p.key_interests) ? p.key_interests : [],
    what_impressed_me: (p.what_impressed_me as string) ?? null,
    potential_synergies: (p.potential_synergies as string) ?? null,
    personality_notes: (p.personality_notes as string) ?? null,
    memory_summary: (p.memory_summary as string) ?? null,
    memory_hook: (p.memory_hook as string) ?? null,
    met_date: typeof p.met_date === "string" ? p.met_date : null,
    relationship_category: (p.relationship_category as string) ?? "other",
    urgency_score:
      typeof p.urgency_score === "number"
        ? Math.min(10, Math.max(1, p.urgency_score))
        : 5,
    suggested_next_steps: normalizeFollowUps(p.suggested_next_steps),
    is_update: null,
    follow_up_questions: [],
  };
}

function normalizeFollowUps(raw: unknown): FollowUpSuggestion[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item: unknown) => {
      // Handle old format (plain string) for backwards compatibility
      if (typeof item === "string") {
        return { action: item, due_days: 2, reason: "" };
      }
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const action = typeof obj.action === "string" ? obj.action : "";
        const due_days = typeof obj.due_days === "number"
          ? Math.min(30, Math.max(0, obj.due_days))
          : 2;
        const reason = typeof obj.reason === "string" ? obj.reason : "";
        if (!action) return null;
        return { action, due_days, reason };
      }
      return null;
    })
    .filter((x): x is FollowUpSuggestion => x !== null);
}
