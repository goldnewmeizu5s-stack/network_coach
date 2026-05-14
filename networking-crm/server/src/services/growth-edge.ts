import { Prisma } from "@prisma/client";
import { anthropic, cachedSystem } from "../lib/ai";
import { config } from "../config";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { buildContactContext } from "./context-builder";
import { GrowthEdgeAnalysis, GrowthPlane, GrowthVerdict } from "../types";

/**
 * Growth Edge ("зона роста") — the chess-theory filter applied to one contact.
 *
 * Principle: you only get stronger by playing a stronger opponent, but
 * "stronger" is never global — it is always per-plane. A person who looks
 * ordinary can be a sensei in ONE narrow dimension. This service finds that
 * plane (compared against THIS user's profile), classifies the relationship,
 * and says how to absorb the edge.
 */

const VALID_VERDICTS: GrowthVerdict[] = ["sensei", "peer", "giver", "unclear"];

const SYSTEM_PROMPT = `You are the strategic growth advisor inside a personal networking CRM. For a single contact, your only job is to find the SPECIFIC DIMENSION(S) — a "plane" — where this person is genuinely stronger than the user, and tell the user exactly what to absorb and how.

THE CORE PRINCIPLE (chess theory):
You only get stronger by playing a stronger opponent. But "stronger" is never global — it is always per-plane. A person who looks completely ordinary can be a sensei in ONE narrow dimension: a value the user lacks, a niche skill, a way of thinking, emotional intelligence, discipline, taste, patience, a domain of knowledge. Your job is to find that plane even when it is not obvious — and to NOT invent one when it isn't there.

THE FILTER (apply it honestly — do NOT flatter):
Answer for this contact: "What does this person do better than THIS user, and can the user learn it by being around them?"
- "sensei" — there is a concrete, nameable plane where they are clearly ahead of the user. The user should invest time aggressively.
- "peer" — they operate on roughly the same level / same planes as the user. A mutual exchange is possible, but this is not a growth priority.
- "giver" — the user can give them more than they can give the user. Fine to keep as a friend if it's pleasant, but do NOT confuse it with development.
- "unclear" — there is not enough information about this contact to judge. Say so honestly.

RULES:
- Ground EVERY judgment in the USER PROFILE provided. The comparison is contact-vs-this-specific-user, never contact-vs-average-person.
- Planes must be SPECIFIC and nameable. Not "he's smart" — but e.g. "structured cold outreach that actually converts", "holds silence in a negotiation", "treats every stranger as already a friend", "deep knowledge of TradFi regulation".
- For each plane give: WHY they're ahead (evidence from their data) + HOW to absorb it — one concrete behaviour the user can do AROUND this person (ask a specific question, shadow a specific thing, propose a specific collaboration, observe a specific habit). Not generic "learn from them".
- 1-3 planes maximum. Quality over quantity. For "giver" or "unclear" verdicts the planes array can be empty.
- "chess_note": one sharp sentence applying the chess principle to THIS person. For "peer"/"giver" it may gently warn against confusing the relationship with growth.
- "priority" (0-100): how aggressively the user should invest in extracting growth here. A sensei with a rare, high-leverage plane → 70-100. A sensei with a modest plane → 40-70. A peer → 15-40. A giver or unclear → 0-15.
- Be honest and discerning. A flattering "everyone is a sensei" output is useless and actively harmful — it destroys the filter. Most contacts are peers or givers; true senseis are rarer.
- Write ALL text fields in the same language as the USER PROFILE (default: Russian).

Return ONLY valid JSON, no markdown, no explanation:
{
  "verdict": "sensei" | "peer" | "giver" | "unclear",
  "headline": "one line — the single biggest thing to take from this person, or why there is nothing to take",
  "planes": [
    { "plane": "short name of the dimension", "why": "why they are ahead of the user here", "how_to_absorb": "one concrete action to learn it from them" }
  ],
  "chess_note": "one sentence applying the chess principle to this person",
  "priority": 0
}`;

async function loadUserProfileForGrowth(): Promise<string> {
  const user = await prisma.user.findFirst();
  if (!user) return "(no user profile available)";

  const prefs = (user.preferences as Record<string, unknown>) || {};
  const navigatorPrompt = prefs.navigator_prompt as string | undefined;

  const lines: string[] = [];
  if (user.name) lines.push(`Name: ${user.name}`);
  if (user.goals) lines.push(`Goals: ${user.goals}`);
  if (user.strengths) lines.push(`Strengths: ${user.strengths}`);
  if (user.weaknesses) lines.push(`Weaknesses / growth areas: ${user.weaknesses}`);
  if (user.fears) lines.push(`Fears: ${user.fears}`);
  const structured = lines.join("\n");

  if (navigatorPrompt) {
    return structured
      ? `${navigatorPrompt}\n\n--- STRUCTURED PROFILE ---\n${structured}`
      : navigatorPrompt;
  }
  return structured || "(no user profile available)";
}

function normalizePlanes(raw: unknown): GrowthPlane[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): GrowthPlane | null => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const plane = typeof o.plane === "string" ? o.plane.trim() : "";
      if (!plane) return null;
      return {
        plane,
        why: typeof o.why === "string" ? o.why.trim() : "",
        how_to_absorb:
          typeof o.how_to_absorb === "string" ? o.how_to_absorb.trim() : "",
      };
    })
    .filter((p): p is GrowthPlane => p !== null)
    .slice(0, 3);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run the AI analysis for one contact. Does NOT touch the database — pure
 * read + AI call. Throws on repeated failure so callers can decide what to do.
 */
export async function analyzeGrowthEdge(
  contactId: string,
): Promise<GrowthEdgeAnalysis> {
  const [userProfile, contactContext] = await Promise.all([
    loadUserProfileForGrowth(),
    buildContactContext(contactId),
  ]);

  if (!contactContext) throw new Error("Contact not found");

  const userMessage = `USER PROFILE (the person who wants to grow):
${userProfile}

---

CONTACT TO ASSESS:
${contactContext}`;

  const system = cachedSystem(
    SYSTEM_PROMPT,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  );

  const maxRetries = 2;
  const backoff = [2000, 6000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userMessage }],
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

      const verdict = VALID_VERDICTS.includes(parsed.verdict as GrowthVerdict)
        ? (parsed.verdict as GrowthVerdict)
        : "unclear";
      const planes = normalizePlanes(parsed.planes);
      const rawPriority =
        typeof parsed.priority === "number"
          ? Math.max(0, Math.min(100, Math.round(parsed.priority)))
          : 0;
      // A sensei with planes should never read as priority 0.
      const priority =
        verdict === "sensei" && planes.length > 0
          ? Math.max(rawPriority, 40)
          : rawPriority;
      const headline =
        typeof parsed.headline === "string" && parsed.headline.trim()
          ? parsed.headline.trim()
          : "Анализ не дал чёткого результата — добавь больше деталей о контакте.";
      const chessNote =
        typeof parsed.chess_note === "string" && parsed.chess_note.trim()
          ? parsed.chess_note.trim()
          : null;

      return { verdict, headline, planes, chess_note: chessNote, priority };
    } catch (err) {
      const isLast = attempt === maxRetries - 1;
      if (isLast) throw err;
      logger.warn(
        `Growth edge analysis attempt ${attempt + 1} failed, retrying`,
        { delay: backoff[attempt] },
      );
      await sleep(backoff[attempt]);
    }
  }

  throw new Error("Growth edge analysis failed after all retries");
}

/**
 * Analyze a contact and upsert the GrowthEdge row. Preserves an existing
 * "dismissed" status across refreshes (a re-analysis shouldn't un-hide it).
 */
export async function analyzeAndSaveGrowthEdge(contactId: string) {
  const analysis = await analyzeGrowthEdge(contactId);
  const planesJson = analysis.planes as unknown as Prisma.InputJsonValue;

  return prisma.growthEdge.upsert({
    where: { contact_id: contactId },
    create: {
      contact_id: contactId,
      verdict: analysis.verdict,
      headline: analysis.headline,
      planes: planesJson,
      chess_note: analysis.chess_note,
      priority: analysis.priority,
      analyzed_at: new Date(),
    },
    update: {
      verdict: analysis.verdict,
      headline: analysis.headline,
      planes: planesJson,
      chess_note: analysis.chess_note,
      priority: analysis.priority,
      analyzed_at: new Date(),
    },
  });
}

/** Fire-and-forget analysis — used when a new contact is created. */
export function analyzeGrowthEdgeAsync(contactId: string): void {
  analyzeAndSaveGrowthEdge(contactId).catch((err) =>
    logger.error("Async growth edge analysis failed", {
      contactId,
      error: String(err),
    }),
  );
}

export interface SenseiSummary {
  contactId: string;
  fullName: string;
  headline: string;
  priority: number;
  planes: GrowthPlane[];
}

/**
 * Top "sensei" contacts the user should actively learn from, highest
 * priority first. Used to push growth into the daily challenge generator.
 */
export async function getTopSenseis(limit = 3): Promise<SenseiSummary[]> {
  const edges = await prisma.growthEdge.findMany({
    where: {
      status: "active",
      verdict: "sensei",
      contact: { warmth_status: { notIn: ["archived", "paused"] } },
    },
    orderBy: { priority: "desc" },
    take: limit,
    include: { contact: { select: { full_name: true } } },
  });

  return edges.map((e) => ({
    contactId: e.contact_id,
    fullName: e.contact.full_name,
    headline: e.headline,
    priority: e.priority,
    planes: ((e.planes as unknown as GrowthPlane[]) ?? []).slice(0, 2),
  }));
}

/** Format senseis for an AI prompt. Returns "" when there are none. */
export function formatSenseisForPrompt(senseis: SenseiSummary[]): string {
  if (senseis.length === 0) return "";
  return senseis
    .map((s) => {
      const planeText = s.planes
        .map((p) => `${p.plane} → ${p.how_to_absorb}`)
        .join("; ");
      return `- ${s.fullName} [priority ${s.priority}]: ${s.headline}${
        planeText ? ` | как расти рядом: ${planeText}` : ""
      }`;
    })
    .join("\n");
}

/**
 * Weekly refresh: (re)analyze every non-archived contact whose growth edge is
 * missing or stale. Dismissed edges are skipped to save API cost. Capped per
 * run so a large network catches up over a few weeks (oldest contacts first).
 */
export async function refreshGrowthEdges(
  opts: { staleDays?: number; limit?: number } = {},
): Promise<{ analyzed: number; failed: number }> {
  const staleDays = opts.staleDays ?? 7;
  const limit = opts.limit ?? 50;
  const staleBefore = new Date(Date.now() - staleDays * 86400000);

  const contacts = await prisma.contact.findMany({
    where: {
      warmth_status: { not: "archived" },
      OR: [
        { growth_edge: { is: null } },
        {
          growth_edge: {
            is: { status: "active", analyzed_at: { lt: staleBefore } },
          },
        },
      ],
    },
    select: { id: true },
    orderBy: { created_at: "asc" },
    take: limit,
  });

  let analyzed = 0;
  let failed = 0;
  for (const c of contacts) {
    try {
      await analyzeAndSaveGrowthEdge(c.id);
      analyzed++;
    } catch (err) {
      failed++;
      logger.error("Growth edge refresh failed for contact", {
        contactId: c.id,
        error: String(err),
      });
    }
  }

  return { analyzed, failed };
}

const VERDICT_LABEL: Record<GrowthVerdict, string> = {
  sensei: "Сенсей",
  peer: "Равный",
  giver: "Ты даёшь больше",
  unclear: "Недостаточно данных",
};

const VERDICT_EMOJI: Record<GrowthVerdict, string> = {
  sensei: "✅",
  peer: "⚠️",
  giver: "❌",
  unclear: "❔",
};

export function verdictLabel(verdict: string): string {
  return VERDICT_LABEL[verdict as GrowthVerdict] ?? verdict;
}

export function verdictEmoji(verdict: string): string {
  return VERDICT_EMOJI[verdict as GrowthVerdict] ?? "❔";
}
