import { Router } from "express";
import prisma from "../lib/prisma";
import {
  loadCachedReactionInsights,
  refreshReactionInsights,
} from "../services/challenge-reactions";

const router = Router();

// GET /api/user/profile
router.get("/profile", async (_req, res, next) => {
  try {
    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({ data: {} });
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /api/user/profile
router.put("/profile", async (req, res, next) => {
  try {
    const { name, goals, fears, strengths, weaknesses, preferences, current_country } = req.body;
    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({ data: {} });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(name !== undefined && { name }),
        ...(goals !== undefined && { goals }),
        ...(fears !== undefined && { fears }),
        ...(strengths !== undefined && { strengths }),
        ...(weaknesses !== undefined && { weaknesses }),
        ...(preferences !== undefined && { preferences }),
        ...(current_country !== undefined && { current_country }),
      },
    });

    // When country changes, reset all location_status for contacts
    if (current_country !== undefined) {
      await prisma.contact.updateMany({
        where: { location_status: { not: null } },
        data: { location_status: null },
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/user/reaction-insights — cached (fast)
router.get("/reaction-insights", async (_req, res, next) => {
  try {
    const cached = await loadCachedReactionInsights();
    res.json({ insights: cached });
  } catch (err) {
    next(err);
  }
});

// POST /api/user/reaction-insights/refresh — recompute + persist
router.post("/reaction-insights/refresh", async (_req, res, next) => {
  try {
    const insights = await refreshReactionInsights();
    res.json({ insights });
  } catch (err) {
    next(err);
  }
});

export default router;
