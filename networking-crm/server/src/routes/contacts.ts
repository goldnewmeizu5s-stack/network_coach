import { Router } from "express";
import prisma from "../lib/prisma";
import {
  isValidTransition,
  getAllowedTransitions,
  recalcAndAutoStatus,
} from "../services/warmth";

const router = Router();

// GET /api/contacts
router.get("/", async (req, res, next) => {
  try {
    const { status, search, sort } = req.query;

    const where: Record<string, unknown> = {};

    if (typeof status === "string" && status) {
      const statuses = status.split(",").map((s) => s.trim());
      where.warmth_status = { in: statuses };
    }

    if (typeof search === "string" && search) {
      where.OR = [
        { full_name: { contains: search, mode: "insensitive" } },
        { nickname: { contains: search, mode: "insensitive" } },
        { occupation: { contains: search, mode: "insensitive" } },
        { company: { contains: search, mode: "insensitive" } },
      ];
    }

    // Sorting
    let orderBy: Record<string, unknown>;
    switch (sort) {
      case "met_date":
        orderBy = { created_at: "desc" };
        break;
      case "warmth_score":
        orderBy = { warmth_score: "desc" };
        break;
      default:
        orderBy = { last_interaction_at: { sort: "desc", nulls: "last" } };
    }

    const contacts = await prisma.contact.findMany({
      where,
      select: {
        id: true,
        full_name: true,
        nickname: true,
        photo_url: true,
        occupation: true,
        company: true,
        warmth_status: true,
        warmth_score: true,
        memory_summary: true,
        last_interaction_at: true,
        created_at: true,
      },
      orderBy,
    });

    res.json(contacts);
  } catch (err) {
    next(err);
  }
});

// GET /api/contacts/counts
router.get("/counts", async (_req, res, next) => {
  try {
    const statuses = ["new", "warming", "warm", "cooling", "paused", "archived"];
    const counts: Record<string, number> = {};
    for (const s of statuses) {
      counts[s] = await prisma.contact.count({
        where: { warmth_status: s },
      });
    }
    counts.all = Object.values(counts).reduce((a, b) => a + b, 0);
    res.json(counts);
  } catch (err) {
    next(err);
  }
});

// GET /api/contacts/:id
router.get("/:id", async (req, res, next) => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: {
        interactions: {
          orderBy: { created_at: "desc" },
          take: 10,
          select: {
            id: true,
            type: true,
            content: true,
            transcript: true,
            ai_summary: true,
            created_at: true,
          },
        },
        follow_ups: {
          where: { status: "pending" },
          orderBy: { due_date: "asc" },
        },
      },
    });

    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    res.json(contact);
  } catch (err) {
    next(err);
  }
});

// POST /api/contacts
router.post("/", async (req, res, next) => {
  try {
    const { full_name, ...rest } = req.body;
    if (!full_name || typeof full_name !== "string" || !full_name.trim()) {
      res.status(400).json({ error: "full_name is required" });
      return;
    }

    const contact = await prisma.contact.create({
      data: {
        full_name: full_name.trim(),
        warmth_status: "new",
        warmth_score: 0,
        ...rest,
      },
    });

    res.status(201).json(contact);
  } catch (err) {
    next(err);
  }
});

// PUT /api/contacts/:id
router.put("/:id", async (req, res, next) => {
  try {
    const { warmth_status, ...rest } = req.body;

    // If updating warmth_status, validate and log
    if (warmth_status) {
      const current = await prisma.contact.findUnique({
        where: { id: req.params.id },
        select: { warmth_status: true },
      });
      if (!current) {
        res.status(404).json({ error: "Contact not found" });
        return;
      }
      if (current.warmth_status !== warmth_status) {
        if (!isValidTransition(current.warmth_status, warmth_status)) {
          res.status(400).json({
            error: `Cannot transition from ${current.warmth_status} to ${warmth_status}`,
            allowed: getAllowedTransitions(current.warmth_status),
          });
          return;
        }
        // Log transition
        await prisma.interaction.create({
          data: {
            contact_id: req.params.id,
            type: "note",
            content: `Status changed from ${current.warmth_status} to ${warmth_status}`,
          },
        });
      }
    }

    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: { ...rest, ...(warmth_status && { warmth_status }) },
    });

    res.json(contact);
  } catch (err) {
    next(err);
  }
});

// PUT /api/contacts/:id/status
router.put("/:id/status", async (req, res, next) => {
  try {
    const { status: newStatus } = req.body;
    if (!newStatus) {
      res.status(400).json({ error: "status is required" });
      return;
    }

    const current = await prisma.contact.findUnique({
      where: { id: req.params.id },
      select: { warmth_status: true },
    });
    if (!current) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    if (!isValidTransition(current.warmth_status, newStatus)) {
      res.status(400).json({
        error: `Cannot transition from ${current.warmth_status} to ${newStatus}`,
        allowed: getAllowedTransitions(current.warmth_status),
      });
      return;
    }

    await prisma.interaction.create({
      data: {
        contact_id: req.params.id,
        type: "note",
        content: `Status changed from ${current.warmth_status} to ${newStatus}`,
      },
    });

    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: { warmth_status: newStatus },
    });

    res.json(contact);
  } catch (err) {
    next(err);
  }
});

// POST /api/contacts/:id/interaction
router.post("/:id/interaction", async (req, res, next) => {
  try {
    const { type, content } = req.body;
    const validTypes = ["meeting", "message", "note"];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
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

    const interaction = await prisma.interaction.create({
      data: {
        contact_id: req.params.id,
        type,
        content: content || null,
      },
    });

    // Update last_interaction_at
    await prisma.contact.update({
      where: { id: req.params.id },
      data: { last_interaction_at: new Date() },
    });

    // Recalculate warmth score and auto-transition
    await recalcAndAutoStatus(req.params.id);

    res.status(201).json(interaction);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/contacts/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const hard = req.query.hard === "true";
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    if (hard) {
      // Hard delete: cascading relations handled by Prisma onDelete: Cascade
      await prisma.contact.delete({ where: { id: req.params.id } });
      res.json({ deleted: true });
    } else {
      // Soft delete: archive
      await prisma.contact.update({
        where: { id: req.params.id },
        data: { warmth_status: "archived" },
      });
      res.json({ archived: true });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
