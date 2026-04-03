import { anthropic } from "../lib/ai";
import { config } from "../config";
import { ExtractedContact, FollowUpSuggestion } from "../types";
import { logger } from "../lib/logger";

const SYSTEM_PROMPT = `You are analyzing a voice note where the user describes someone they just met or wants to update information about an existing contact.

Extract the following into structured JSON (use null for unknown fields):
{
  "full_name": "string or null",
  "nickname": "string or null",
  "where_met": "event, location, context or null",
  "occupation": "what they do or null",
  "company": "string or null",
  "city": "string or null",
  "country": "string or null",
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
  "memory_summary": "2-3 sentence essence that would remind the user who this person is months later",
  "is_update": false
}

CRITICAL rules for suggested_next_steps:
- Each step is an object with "action" (what to do), "due_days" (days from now), and "reason" (why)
- NEVER suggest something the user already plans to do. If they say "we're meeting tomorrow" or "going hiking together" — that's ALREADY happening, don't create a follow-up for it
- Instead, think about what should happen AFTER the planned event: "После хайкинга — написать что было круто и предложить следующую встречу"
- due_days should be SMART: if a meeting is tomorrow, the follow-up should be in 2-3 days (after the meeting). If no meeting planned, follow up in 1-2 days while the connection is fresh
- Generate 1-3 follow-ups. Each should be a DIFFERENT type of action (don't repeat similar actions)
- Good follow-ups: send a useful resource, introduce to someone, follow up after a planned meeting, share something relevant to their interests
- Bad follow-ups: generic "stay in touch", repeating what's already planned, vague actions

Other rules:
- If the user speaks in Russian, write action, reason, and memory_summary in Russian
- memory_summary should capture the UNIQUE essence of this person, not generic descriptions
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

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: transcript }],
      });

      const text =
        message.content[0].type === "text" ? message.content[0].text : "";

      const parsed = JSON.parse(text) as ExtractedContact;

      // Validate & normalize
      return {
        full_name: parsed.full_name ?? null,
        nickname: parsed.nickname ?? null,
        where_met: parsed.where_met ?? null,
        occupation: parsed.occupation ?? null,
        company: parsed.company ?? null,
        city: parsed.city ?? null,
        country: parsed.country ?? null,
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
        is_update: parsed.is_update ?? null,
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
