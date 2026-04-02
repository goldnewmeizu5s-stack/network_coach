import { Router } from "express";
import { generateDailyInsight } from "../services/message-drafting";

const router = Router();

// POST /api/insights/daily
router.post("/daily", async (_req, res, next) => {
  try {
    const insight = await generateDailyInsight();
    res.json({ insight });
  } catch (err) {
    next(err);
  }
});

export default router;
