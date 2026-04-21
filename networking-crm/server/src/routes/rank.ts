import { Router } from "express";
import { computeRank, RANKS } from "../services/rank";

const router = Router();

// GET /api/rank — current rank breakdown for the sole user
router.get("/", async (_req, res, next) => {
  try {
    const payload = await computeRank();
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/rank/ladder — static list of all ranks for the detail page
router.get("/ladder", (_req, res) => {
  res.json({ ranks: RANKS });
});

export default router;
