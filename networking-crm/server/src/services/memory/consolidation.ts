import prisma from "../../lib/prisma";
import { anthropic } from "../../lib/ai";
import { config } from "../../config";
import { logger } from "../../lib/logger";
import { indexContactMemory } from "./memory-indexer";

interface ConsolidationOutput {
  summary: string;
  new_hooks: string[];
}

const RECENT_WINDOW_DAYS = 14;
const MAX_RECENT_CHUNKS = 20;
const MAX_EXISTING_HOOKS = 20;
const MAX_NEW_HOOKS = 5;

function stripJson(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function parseConsolidation(raw: string): ConsolidationOutput | null {
  const cleaned = stripJson(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") return null;
    const summary =
      typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const hooks = Array.isArray(parsed.new_hooks)
      ? parsed.new_hooks
          .filter((h: unknown) => typeof h === "string")
          .map((h: string) => h.trim())
          .filter((h: string) => h.length > 0 && h.length <= 300)
          .slice(0, MAX_NEW_HOOKS)
      : [];
    if (!summary && hooks.length === 0) return null;
    return { summary, new_hooks: hooks };
  } catch {
    return null;
  }
}

/**
 * Re-read recent memory for a single contact and ask Claude to refresh
 * memory_summary + propose new sticky memory_notes (hooks).
 * Safe to call repeatedly — hooks are de-duplicated case-insensitively.
 */
export async function consolidateContact(contactId: string): Promise<{
  updatedSummary: boolean;
  newHooks: number;
}> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      full_name: true,
      occupation: true,
      company: true,
      relationship_category: true,
      warmth_status: true,
      key_interests: true,
      personality_notes: true,
      what_impressed_me: true,
      potential_synergies: true,
      memory_summary: true,
      memory_notes: true,
      personal_notes: true,
    },
  });
  if (!contact) return { updatedSummary: false, newHooks: 0 };

  const windowStart = new Date(Date.now() - RECENT_WINDOW_DAYS * 86400000);

  const [recentInteractions, linkedNotes, recentChunks] = await Promise.all([
    prisma.interaction.findMany({
      where: {
        contact_id: contactId,
        created_at: { gte: windowStart },
        OR: [
          { ai_summary: { not: null } },
          { transcript: { not: null } },
          { content: { not: null } },
        ],
      },
      orderBy: { created_at: "desc" },
      take: 10,
      select: {
        type: true,
        ai_summary: true,
        transcript: true,
        content: true,
        created_at: true,
      },
    }),
    (async () => {
      const links = await prisma.noteLink.findMany({
        where: { target_type: "contact", target_id: contactId },
        select: { from_note_id: true },
        take: 50,
      });
      if (links.length === 0) return [];
      return prisma.note.findMany({
        where: { id: { in: links.map((l) => l.from_note_id) } },
        orderBy: { updated_at: "desc" },
        take: 5,
        select: { title: true, body: true, updated_at: true },
      });
    })(),
    prisma.$queryRawUnsafe<
      { source_type: string; text: string; created_at: Date }[]
    >(
      `SELECT source_type, text, created_at
       FROM "MemoryChunk"
       WHERE contact_id = $1 AND created_at >= $2
       ORDER BY created_at DESC
       LIMIT $3`,
      contactId,
      windowStart,
      MAX_RECENT_CHUNKS,
    ),
  ]);

  const hasRecentActivity =
    recentInteractions.length > 0 ||
    linkedNotes.length > 0 ||
    recentChunks.length > 0;
  if (!hasRecentActivity && contact.memory_summary) {
    return { updatedSummary: false, newHooks: 0 };
  }

  const existingHooks = contact.memory_notes.slice(0, MAX_EXISTING_HOOKS);
  const existingHooksLower = new Set(existingHooks.map((h) => h.toLowerCase()));

  const interactionBlock = recentInteractions
    .map((i) => {
      const body = (i.ai_summary || i.transcript || i.content || "")
        .replace(/\s+/g, " ")
        .slice(0, 400);
      const date = i.created_at.toISOString().slice(0, 10);
      return `[${date}] (${i.type}) ${body}`;
    })
    .join("\n") || "(none)";

  const notesBlock = linkedNotes
    .map((n) => {
      const body = n.body.replace(/\s+/g, " ").slice(0, 400);
      const date = n.updated_at.toISOString().slice(0, 10);
      return `[${date}] ${n.title || "(note)"}: ${body}`;
    })
    .join("\n") || "(none)";

  const chunkBlock = recentChunks
    .filter((c) => c.source_type !== "contact_memory")
    .map((c) => {
      const date = c.created_at.toISOString().slice(0, 10);
      const body = c.text.replace(/\s+/g, " ").slice(0, 300);
      return `[${date}] (${c.source_type}) ${body}`;
    })
    .join("\n") || "(none)";

  const contactHeader = [
    `Name: ${contact.full_name}`,
    contact.occupation && `Occupation: ${contact.occupation}`,
    contact.company && `Company: ${contact.company}`,
    contact.relationship_category && `Category: ${contact.relationship_category}`,
    contact.warmth_status && `Warmth: ${contact.warmth_status}`,
    contact.key_interests.length > 0 &&
      `Interests: ${contact.key_interests.join(", ")}`,
    contact.personality_notes && `Personality: ${contact.personality_notes}`,
    contact.what_impressed_me && `What impressed me: ${contact.what_impressed_me}`,
    contact.potential_synergies && `Synergies: ${contact.potential_synergies}`,
    contact.personal_notes && `Personal notes: ${contact.personal_notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You maintain a personal CRM memory for the user. For each contact you produce two things:
1. A crisp 2-4 sentence "memory_summary" a friend would write about this person — who they are, what defines them, relationship vibe.
2. Up to ${MAX_NEW_HOOKS} short new "memory hooks": sticky, specific details a person would want to remember to feel warm and remembered next time (e.g. "dog named Chewie", "training for Berlin marathon", "left Uber to start own fund").

Rules:
- Write in the same language the source material uses (usually Russian).
- Hooks must be 3-20 words, concrete, NOT duplicates of existing hooks.
- Do NOT invent facts. Only use what's in the source.
- Skip vague hooks like "nice person".
- Reply ONLY with valid JSON matching {"summary": string, "new_hooks": string[]}.`;

  const prompt = `CONTACT:
${contactHeader}

EXISTING SUMMARY:
${contact.memory_summary || "(none)"}

EXISTING HOOKS (do not repeat these):
${existingHooks.map((h) => `- ${h}`).join("\n") || "(none)"}

RECENT INTERACTIONS (last ${RECENT_WINDOW_DAYS} days):
${interactionBlock}

LINKED NOTES:
${notesBlock}

OTHER RECENT MEMORY CHUNKS:
${chunkBlock}

Produce the refreshed summary and new hooks.`;

  let raw = "";
  try {
    const res = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    raw = res.content[0]?.type === "text" ? res.content[0].text : "";
  } catch (err) {
    logger.error("consolidateContact Claude call failed", {
      contactId,
      error: String(err),
    });
    return { updatedSummary: false, newHooks: 0 };
  }

  const parsed = parseConsolidation(raw);
  if (!parsed) {
    logger.warn("consolidateContact: could not parse response", { contactId });
    return { updatedSummary: false, newHooks: 0 };
  }

  const freshHooks = parsed.new_hooks.filter(
    (h) => !existingHooksLower.has(h.toLowerCase()),
  );
  const mergedHooks = [...existingHooks, ...freshHooks];

  const updates: Record<string, unknown> = {};
  let updatedSummary = false;
  if (parsed.summary && parsed.summary !== contact.memory_summary) {
    updates.memory_summary = parsed.summary;
    updatedSummary = true;
  }
  if (freshHooks.length > 0) {
    updates.memory_notes = mergedHooks;
  }

  if (Object.keys(updates).length === 0) {
    return { updatedSummary: false, newHooks: 0 };
  }

  await prisma.contact.update({ where: { id: contactId }, data: updates });
  await indexContactMemory(contactId);

  logger.info("consolidateContact: updated", {
    contactId,
    name: contact.full_name,
    updatedSummary,
    newHooks: freshHooks.length,
  });

  return { updatedSummary, newHooks: freshHooks.length };
}

/**
 * Find contacts with activity in the last N days and consolidate each.
 * Serial execution + small delay to respect API rate limits.
 */
export async function consolidateAllContacts(opts: {
  windowDays?: number;
  limit?: number;
  delayMs?: number;
} = {}): Promise<{ processed: number; updated: number; newHooks: number }> {
  const windowDays = opts.windowDays ?? RECENT_WINDOW_DAYS;
  const limit = opts.limit ?? 40;
  const delayMs = opts.delayMs ?? 1500;

  const since = new Date(Date.now() - windowDays * 86400000);

  const rows = await prisma.$queryRawUnsafe<{ contact_id: string }[]>(
    `SELECT DISTINCT contact_id
     FROM "MemoryChunk"
     WHERE contact_id IS NOT NULL
       AND source_type <> 'contact_memory'
       AND created_at >= $1
     ORDER BY contact_id
     LIMIT $2`,
    since,
    limit,
  );

  let processed = 0;
  let updated = 0;
  let newHooks = 0;

  for (const row of rows) {
    processed++;
    try {
      const res = await consolidateContact(row.contact_id);
      if (res.updatedSummary) updated++;
      newHooks += res.newHooks;
    } catch (err) {
      logger.error("consolidateAllContacts: item failed", {
        contactId: row.contact_id,
        error: String(err),
      });
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  logger.info("consolidateAllContacts: done", { processed, updated, newHooks });
  return { processed, updated, newHooks };
}
