import { Router } from "express";
import prisma from "../lib/prisma";
import {
  INTEREST_TIERS,
  InterestTier,
  addOrTouchGoal,
  applyManualTierChange,
  recalcAndAutoInterestTier,
  setGoalStatus,
  unlockTier,
} from "../services/interest";

const router = Router();

const VALID_GOAL_STATUSES = ["open", "satisfied", "abandoned", "all"] as const;

// GET /api/contacts/:id/goals?status=open|satisfied|abandoned|all
router.get("/contacts/:id/goals", async (req, res, next) => {
  try {
    const status = (req.query.status as string) || "open";
    if (!VALID_GOAL_STATUSES.includes(status as (typeof VALID_GOAL_STATUSES)[number])) {
      res.status(400).json({ error: "invalid status filter" });
      return;
    }

    const where =
      status === "all"
        ? { contact_id: req.params.id }
        : { contact_id: req.params.id, status };

    const goals = await prisma.interestGoal.findMany({
      where,
      orderBy: [{ status: "asc" }, { last_mentioned_at: "desc" }],
    });
    res.json(goals);
  } catch (err) {
    next(err);
  }
});

// POST /api/contacts/:id/goals  { description }
router.post("/contacts/:id/goals", async (req, res, next) => {
  try {
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    if (!description) {
      res.status(400).json({ error: "description is required" });
      return;
    }

    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const { goalId } = await addOrTouchGoal(req.params.id, description, "user");
    const goal = await prisma.interestGoal.findUnique({ where: { id: goalId } });
    res.status(201).json(goal);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/goals/:goalId  { status: "open" | "satisfied" | "abandoned" }
router.patch("/goals/:goalId", async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (status !== "open" && status !== "satisfied" && status !== "abandoned") {
      res.status(400).json({ error: "status must be one of: open, satisfied, abandoned" });
      return;
    }

    const goal = await prisma.interestGoal.findUnique({
      where: { id: req.params.goalId },
      select: { id: true, contact_id: true, status: true },
    });
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }

    if (status === "open") {
      // Manual reopen — reset satisfied_at and re-evaluate.
      await prisma.interestGoal.update({
        where: { id: goal.id },
        data: {
          status: "open",
          satisfied_at: null,
          satisfied_by_interaction_id: null,
          last_mentioned_at: new Date(),
        },
      });
      await prisma.contact.update({
        where: { id: goal.contact_id },
        data: { last_goal_event_at: new Date() },
      });
      await recalcAndAutoInterestTier(goal.contact_id);
    } else {
      await setGoalStatus(goal.id, status);
    }

    const updated = await prisma.interestGoal.findUnique({ where: { id: goal.id } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/goals/:goalId — outright remove (e.g. typo)
router.delete("/goals/:goalId", async (req, res, next) => {
  try {
    const goal = await prisma.interestGoal.findUnique({
      where: { id: req.params.goalId },
      select: { contact_id: true },
    });
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    await prisma.interestGoal.delete({ where: { id: req.params.goalId } });
    await recalcAndAutoInterestTier(goal.contact_id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/contacts/:id/interest-tier  { tier: "active" | "maintenance" | "dormant", lock?: boolean }
router.patch("/contacts/:id/interest-tier", async (req, res, next) => {
  try {
    const tier = req.body?.tier as InterestTier | undefined;
    if (!tier || !INTEREST_TIERS.includes(tier)) {
      res
        .status(400)
        .json({ error: `tier must be one of: ${INTEREST_TIERS.join(", ")}` });
      return;
    }

    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    if (req.body?.lock === false) {
      // Caller wants the cron to take over again.
      await prisma.contact.update({
        where: { id: req.params.id },
        data: { interest_tier: tier },
      });
      await unlockTier(req.params.id);
      await recalcAndAutoInterestTier(req.params.id);
    } else {
      await applyManualTierChange(req.params.id, tier);
    }

    const updated = await prisma.contact.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        interest_tier: true,
        interest_score: true,
        tier_locked: true,
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
