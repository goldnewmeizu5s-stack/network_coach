import { Router } from "express";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { updateChallengeSchema } from "../lib/validators";
import {
  generateDailyChallenge,
  generateAlternativeChallenges,
} from "../services/challenge-engine";

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
      // Re-fetch with methodology included
      challenges = await prisma.challenge.findMany({
        where: { id: { in: ids } },
        include: { methodology: { select: { title: true, source: true } } },
        orderBy: { created_at: "asc" },
      });
    }

    const [main, ...alternatives] = challenges;

    res.json({ challenge: main, alternatives });
  } catch (err) {
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

    // Streak
    let streak = 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const dayStart = new Date(now.getTime() - i * 86400000);
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      const dayCompleted = challenges.some(
        (c) =>
          c.status === "completed" &&
          c.date >= dayStart &&
          c.date < dayEnd
      );
      // For days beyond our query, check DB
      if (i >= days) {
        const count = await prisma.challenge.count({
          where: {
            date: { gte: dayStart, lt: dayEnd },
            status: "completed",
          },
        });
        if (count > 0) {
          streak++;
        } else {
          break;
        }
      } else if (dayCompleted) {
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
