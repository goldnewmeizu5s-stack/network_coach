import { Router } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/contacts
router.get("/", async (req, res, next) => {
  try {
    const { status, search } = req.query;

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
      orderBy: { last_interaction_at: { sort: "desc", nulls: "last" } },
    });

    res.json(contacts);
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
router.post("/", (_req, res) => {
  res.status(501).json({ message: "not implemented yet" });
});

// PUT /api/contacts/:id
router.put("/:id", async (req, res, next) => {
  try {
    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(contact);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/contacts/:id
router.delete("/:id", (_req, res) => {
  res.status(501).json({ message: "not implemented yet" });
});

export default router;
