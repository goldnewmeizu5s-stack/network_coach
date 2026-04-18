import prisma from "../lib/prisma";
import { logger } from "../lib/logger";

export interface CategoryReactionStats {
  category: string;
  completed: number;
  skipped: number;
  too_hard: number;
  total: number;
  avg_rating: number | null;
  completion_rate: number;
}

export interface ReactionInsights {
  by_category: CategoryReactionStats[];
  loved: {
    title: string;
    category: string;
    rating: number;
    reflection: string | null;
    completed_at: string;
  }[];
  rejected: {
    title: string;
    category: string;
    status: string;
    date: string;
  }[];
  generated_at: string;
}

const WINDOW_DAYS = 30;

export async function analyzeReactions(): Promise<ReactionInsights> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000);

  const grouped = await prisma.challenge.groupBy({
    by: ["category", "status"],
    where: { date: { gte: since } },
    _count: true,
    _avg: { rating: true },
  });

  const byCat = new Map<string, CategoryReactionStats>();
  for (const row of grouped) {
    const cur =
      byCat.get(row.category) ||
      ({
        category: row.category,
        completed: 0,
        skipped: 0,
        too_hard: 0,
        total: 0,
        avg_rating: null,
        completion_rate: 0,
      } as CategoryReactionStats);
    const n = row._count;
    cur.total += n;
    if (row.status === "completed") {
      cur.completed += n;
      cur.avg_rating = row._avg.rating ?? null;
    } else if (row.status === "skipped") {
      cur.skipped += n;
    } else if (row.status === "too_hard") {
      cur.too_hard += n;
    }
    byCat.set(row.category, cur);
  }
  for (const s of byCat.values()) {
    s.completion_rate =
      s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
  }

  const [loved, rejected] = await Promise.all([
    prisma.challenge.findMany({
      where: {
        status: "completed",
        rating: { gte: 4 },
        date: { gte: since },
      },
      orderBy: [{ rating: "desc" }, { completed_at: "desc" }],
      take: 5,
      select: {
        title: true,
        category: true,
        rating: true,
        reflection: true,
        completed_at: true,
      },
    }),
    prisma.challenge.findMany({
      where: {
        status: { in: ["skipped", "too_hard"] },
        date: { gte: since },
      },
      orderBy: { date: "desc" },
      take: 5,
      select: {
        title: true,
        category: true,
        status: true,
        date: true,
      },
    }),
  ]);

  const insights: ReactionInsights = {
    by_category: Array.from(byCat.values()).sort(
      (a, b) => b.total - a.total,
    ),
    loved: loved.map((c) => ({
      title: c.title,
      category: c.category,
      rating: c.rating ?? 0,
      reflection: c.reflection,
      completed_at:
        c.completed_at?.toISOString().slice(0, 10) ??
        new Date().toISOString().slice(0, 10),
    })),
    rejected: rejected.map((c) => ({
      title: c.title,
      category: c.category,
      status: c.status,
      date: c.date.toISOString().slice(0, 10),
    })),
    generated_at: new Date().toISOString(),
  };

  return insights;
}

/**
 * Save insights into user.preferences.reaction_insights so the challenge
 * engine can read them without recomputing on every call.
 *
 * Uses jsonb_set so this is a single atomic DB write and does NOT race
 * with PUT /user/profile (which also writes preferences): only the
 * reaction_insights key is touched.
 */
export async function persistReactionInsights(
  insights: ReactionInsights,
): Promise<void> {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) return;

  const json = JSON.stringify(insights);
  await prisma.$executeRaw`
    UPDATE "User"
    SET preferences = jsonb_set(
      COALESCE(preferences, '{}'::jsonb),
      '{reaction_insights}',
      ${json}::jsonb,
      true
    )
    WHERE id = ${user.id}
  `;
}

export async function loadCachedReactionInsights(): Promise<ReactionInsights | null> {
  const user = await prisma.user.findFirst();
  if (!user) return null;
  const prefs = (user.preferences as Record<string, unknown>) || {};
  const cached = prefs.reaction_insights;
  if (!cached || typeof cached !== "object") return null;
  return cached as unknown as ReactionInsights;
}

/**
 * Formats insights as a compact prompt block for the challenge generator.
 * Returns empty string when there is nothing useful to show yet.
 */
export function formatReactionInsightsForPrompt(
  insights: ReactionInsights | null,
): string {
  if (!insights) return "";
  const parts: string[] = [];

  if (insights.by_category.length > 0) {
    const lines = insights.by_category
      .slice(0, 6)
      .map((c) => {
        const rating =
          c.avg_rating != null ? `, avg rating ${c.avg_rating.toFixed(1)}/5` : "";
        return `- ${c.category}: ${c.completion_rate}% done (${c.completed}/${c.total})${rating}`;
      });
    parts.push(`CATEGORY REACTIONS (last ${WINDOW_DAYS}d):\n${lines.join("\n")}`);
  }

  if (insights.loved.length > 0) {
    const lines = insights.loved.map((c) => {
      const reflection = c.reflection
        ? ` — "${c.reflection.replace(/\s+/g, " ").slice(0, 120)}"`
        : "";
      return `- [${c.category}, ${c.rating}/5] ${c.title}${reflection}`;
    });
    parts.push(`LOVED (do more like these):\n${lines.join("\n")}`);
  }

  if (insights.rejected.length > 0) {
    const lines = insights.rejected.map(
      (c) => `- [${c.category}, ${c.status}] ${c.title}`,
    );
    parts.push(`REJECTED (avoid or reshape):\n${lines.join("\n")}`);
  }

  return parts.join("\n\n");
}

/**
 * Run analysis and persist. Safe to call from cron or admin endpoint.
 */
export async function refreshReactionInsights(): Promise<ReactionInsights> {
  const insights = await analyzeReactions();
  try {
    await persistReactionInsights(insights);
  } catch (err) {
    logger.error("persistReactionInsights failed", { error: String(err) });
  }
  return insights;
}
