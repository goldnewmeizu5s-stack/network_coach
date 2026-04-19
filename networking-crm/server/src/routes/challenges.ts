import { Router } from "express";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { updateChallengeSchema } from "../lib/validators";
import {
  generateDailyChallenge,
  generateAlternativeChallenges,
} from "../services/challenge-engine";
import {
  generateLocationChallenges,
  applyDatingFlavorRoll,
} from "../services/location-challenge-engine";
import { indexChallengeAsync } from "../services/memory/memory-indexer";

const router = Router();

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

// GET /api/challenges/today
router.get("/today", async (_req, res, next) => {
  try {
    const { start, end } = todayRange();

    // Check for existing today's challenge (main one = first created)
    let challenges = await prisma.challenge.findMany({
      where: { date: { gte: start, lt: end } },
      include: { methodology: { select: { title: true, source: true } } },
      orderBy: { created_at: "asc" },
    });

    if (challenges.length === 0) {
      // Generate main + alternatives
      const main = await generateDailyChallenge();
      const alts = await generateAlternativeChallenges();
      const ids = [main.id, ...alts.map((a) => a.id)];
      // Give each new non-location challenge a small chance of dating flavor
      await applyDatingFlavorRoll(ids);
      // Re-fetch with methodology included
      challenges = await prisma.challenge.findMany({
        where: { id: { in: ids } },
        include: { methodology: { select: { title: true, source: true } } },
        orderBy: { created_at: "asc" },
      });
    }

    // Split: daily (non-location) first, location-based at the end as alternatives
    const daily = challenges.filter((c) => !c.is_location_based);
    const location = challenges.filter((c) => c.is_location_based);
    const ordered = [...daily, ...location];
    const [main, ...alternatives] = ordered;

    res.json({ challenge: main, alternatives });
  } catch (err) {
    next(err);
  }
});

// POST /api/challenges/by-location
// Body: { context: string }  OR  { voice_interaction_id: string }
router.post("/by-location", async (req, res, next) => {
  try {
    const { context, voice_interaction_id } = req.body || {};

    let resolvedContext = "";
    let source: "text" | "voice" = "text";

    if (typeof context === "string" && context.trim().length > 0) {
      resolvedContext = context.trim().slice(0, 2000);
    } else if (typeof voice_interaction_id === "string") {
      const interaction = await prisma.interaction.findUnique({
        where: { id: voice_interaction_id },
        select: { transcript: true },
      });
      if (!interaction?.transcript) {
        res
          .status(400)
          .json({ error: "Voice interaction has no transcript yet" });
        return;
      }
      resolvedContext = interaction.transcript.trim().slice(0, 2000);
      source = "voice";
    } else {
      res
        .status(400)
        .json({ error: "Provide either 'context' or 'voice_interaction_id'" });
      return;
    }

    const created = await generateLocationChallenges({
      context: resolvedContext,
      transcriptSource: source,
    });
    const ids = created.map((c) => c.id);
    const challenges = await prisma.challenge.findMany({
      where: { id: { in: ids } },
      include: { methodology: { select: { title: true, source: true } } },
      orderBy: { created_at: "asc" },
    });

    res.status(201).json({ challenges, context: resolvedContext, source });
  } catch (err) {
    logger.error("by-location generation failed", { error: String(err) });
    next(err);
  }
});

// GET /api/challenges/history
router.get("/history", async (req, res, next) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const since = new Date(Date.now() - days * 86400000);

    const challenges = await prisma.challenge.findMany({
      where: { date: { gte: since } },
      include: { methodology: { select: { title: true, source: true } } },
      orderBy: { date: "desc" },
    });

    // Stats
    const total = challenges.length;
    const completed = challenges.filter(
      (c) => c.status === "completed"
    ).length;

    const byCategory: Record<
      string,
      { total: number; completed: number }
    > = {};
    for (const c of challenges) {
      if (!byCategory[c.category]) {
        byCategory[c.category] = { total: 0, completed: 0 };
      }
      byCategory[c.category].total++;
      if (c.status === "completed") byCategory[c.category].completed++;
    }

    // Streak — single query approach
    const yearAgo = new Date(Date.now() - 365 * 86400000);
    const allCompleted = await prisma.challenge.findMany({
      where: { status: "completed", date: { gte: yearAgo } },
      select: { date: true },
    });
    const completedDays = new Set(
      allCompleted.map((c) => c.date.toISOString().slice(0, 10))
    );

    let streak = 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const day = new Date(now.getTime() - i * 86400000);
      if (completedDays.has(day.toISOString().slice(0, 10))) {
        streak++;
      } else {
        break;
      }
    }

    res.json({
      challenges,
      stats: {
        completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
        streak,
        by_category: byCategory,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/challenges/:id
router.put("/:id", async (req, res, next) => {
  try {
    const parsed = updateChallengeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { status, reflection, rating } = parsed.data;

    const existing = await prisma.challenge.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Challenge not found" });
      return;
    }

    const data: Record<string, unknown> = { status };
    if (status === "completed") {
      data.completed_at = new Date();
      if (reflection) data.reflection = reflection;
      if (typeof rating === "number")
        data.rating = Math.max(1, Math.min(5, rating));
    }

    const challenge = await prisma.challenge.update({
      where: { id: req.params.id },
      data,
      include: { methodology: { select: { title: true, source: true } } },
    });

    indexChallengeAsync(challenge.id);

    // Update streak in user preferences
    if (status === "completed") {
      try {
        await updateStreak();
      } catch (err) {
        logger.error("Failed to update streak", { error: String(err) });
      }
    }

    res.json(challenge);
  } catch (err) {
    next(err);
  }
});

// POST /api/challenges/generate — force generate for dev
router.post("/generate", async (_req, res, next) => {
  try {
    const challenge = await generateDailyChallenge();
    const alts = await generateAlternativeChallenges();
    res.status(201).json({ challenge, alternatives: alts });
  } catch (err) {
    next(err);
  }
});

async function updateStreak(): Promise<void> {
  const user = await prisma.user.findFirst();
  if (!user) return;

  const prefs = (user.preferences as Record<string, unknown>) || {};
  const today = new Date().toDateString();
  const lastStreakDate = (prefs.last_streak_date as string) || "";
  const currentStreak = (prefs.challenge_streak as number) || 0;

  if (lastStreakDate === today) return; // Already counted today

  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const newStreak = lastStreakDate === yesterday ? currentStreak + 1 : 1;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      preferences: {
        ...prefs,
        challenge_streak: newStreak,
        last_streak_date: today,
      },
    },
  });
}

export default router;
