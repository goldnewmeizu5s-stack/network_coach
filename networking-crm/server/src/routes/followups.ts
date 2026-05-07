import { Router } from "express";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { aiLimiter } from "../lib/rate-limit";
import { createFollowUpSchema, updateFollowUpSchema } from "../lib/validators";
import { recalcAndAutoStatus } from "../services/warmth";
import { recalcAndAutoInterestTier } from "../services/interest";
import { generateFollowUpsForContact } from "../services/followup-engine";
import { draftFollowUpMessage } from "../services/message-drafting";
const router = Router();

// GET /api/followups
router.get("/", async (req, res, next) => {
  try {
    const status = (req.query.status as string) || "pending";
    const contactId = req.query.contact_id as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const statusFilter =
      status === "pending"
        ? {
            OR: [
              { status: "pending" as const },
              { status: "snoozed" as const, snoozed_until: { lte: new Date() } },
            ],
          }
        : { status };

    const where = contactId
      ? { AND: [statusFilter, { contact_id: contactId }] }
      : statusFilter;

    const followUps = await prisma.followUp.findMany({
      where,
      include: {
        contact: {
          select: {
            full_name: true,
            warmth_status: true,
            photo_url: true,
          },
        },
      },
      orderBy: [{ due_date: "asc" }, { priority: "desc" }],
      take: limit,
      skip: offset,
    });

    res.json(followUps);
  } catch (err) {
    next(err);
  }
});

// PUT /api/followups/:id
router.put("/:id", async (req, res, next) => {
  try {
    const parsed = updateFollowUpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { status, snoozed_until } = parsed.data;

    const followUp = await prisma.followUp.findUnique({
      where: { id: req.params.id },
      select: { id: true, contact_id: true, suggested_action: true },
    });
    if (!followUp) {
      res.status(404).json({ error: "Follow-up not found" });
      return;
    }

    if (status === "done") {
      // Mark as done
      const updated = await prisma.followUp.update({
        where: { id: req.params.id },
        data: { status: "done", completed_at: new Date() },
      });

      // Log interaction
      await prisma.interaction.create({
        data: {
          contact_id: followUp.contact_id,
          type: "follow_up",
          content: followUp.suggested_action,
        },
      });

      // Update last_interaction_at
      await prisma.contact.update({
        where: { id: followUp.contact_id },
        data: { last_interaction_at: new Date() },
      });

      // Recalculate warmth and interest tier (the latter sees the new "done" follow-up
      // and any goals that were satisfied via this completion).
      await recalcAndAutoStatus(followUp.contact_id);
      await recalcAndAutoInterestTier(followUp.contact_id);

      res.json(updated);
    } else if (status === "snoozed") {
      if (!snoozed_until) {
        res.status(400).json({ error: "snoozed_until is required" });
        return;
      }
      const updated = await prisma.followUp.update({
        where: { id: req.params.id },
        data: {
          status: "snoozed",
          snoozed_until: new Date(snoozed_until),
        },
      });
      res.json(updated);
    } else if (status === "skipped") {
      const updated = await prisma.followUp.update({
        where: { id: req.params.id },
        data: { status: "skipped" },
      });
      // Skips feed the interest score penalty.
      await recalcAndAutoInterestTier(followUp.contact_id);
      res.json(updated);
    } else {
      res.status(400).json({
        error: "status must be one of: done, snoozed, skipped",
      });
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/followups — create manual follow-up
router.post("/", async (req, res, next) => {
  try {
    const parsed = createFollowUpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { contact_id, suggested_action, due_date, priority } = parsed.data;

    const followUp = await prisma.followUp.create({
      data: {
        contact_id,
        suggested_action,
        due_date: new Date(due_date),
        priority: priority || 5,
      },
    });

    res.status(201).json(followUp);
  } catch (err) {
    next(err);
  }
});

// POST /api/followups/generate
router.post("/generate", async (req, res, next) => {
  try {
    const { contact_id } = req.body;
    if (!contact_id) {
      res.status(400).json({ error: "contact_id is required" });
      return;
    }

    const drafts = await generateFollowUpsForContact(contact_id);
    const created = [];
    for (const draft of drafts) {
      const fu = await prisma.followUp.create({ data: draft });
      created.push(fu);
    }

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// POST /api/followups/:id/draft — AI message drafting
router.post("/:id/draft", aiLimiter, async (req, res, next) => {
  try {
    const followUp = await prisma.followUp.findUnique({
      where: { id: req.params.id as string },
      select: { contact_id: true, suggested_action: true },
    });
    if (!followUp) {
      res.status(404).json({ error: "Follow-up not found" });
      return;
    }

    const messages = await draftFollowUpMessage(
      followUp.contact_id,
      followUp.suggested_action
    );

    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

export default router;
