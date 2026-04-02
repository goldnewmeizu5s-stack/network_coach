import { anthropic } from "../lib/ai";
import { ExtractedContact } from "../types";
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
  "suggested_next_steps": ["array of 2-3 concrete follow-up actions"],
  "urgency_score": 5,  // 1-10, how quickly should the user follow up
  "relationship_category": "business|friendship|mentor|connector|investor|creative|other",
  "memory_summary": "2-3 sentence essence that would remind the user who this person is months later",
  "is_update": false  // true if this sounds like an update about existing contact, not a new person
}

Rules:
- If the user speaks in Russian, extract data but write memory_summary and suggested_next_steps in Russian
- Be specific in suggested_next_steps — reference actual details from the description
- memory_summary should capture the UNIQUE essence of this person, not generic descriptions
- If the transcript doesn't describe a person (e.g., the user is just talking or asking a question), set "is_update" to null and return all other fields as null
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
        model: "claude-opus-4-20250514",
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
        suggested_next_steps: Array.isArray(parsed.suggested_next_steps)
          ? parsed.suggested_next_steps
          : [],
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
