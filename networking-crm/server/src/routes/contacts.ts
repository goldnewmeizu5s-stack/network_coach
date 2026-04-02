import { Router } from "express";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { aiLimiter } from "../lib/rate-limit";
import {
  createContactSchema,
  updateContactSchema,
  batchActionSchema,
  interactionSchema,
} from "../lib/validators";
import {
  isValidTransition,
  getAllowedTransitions,
  recalcAndAutoStatus,
} from "../services/warmth";
import { suggestActions } from "../services/message-drafting";

const router = Router();

// GET /api/contacts
router.get("/", async (req, res, next) => {
  try {
    const {
      status,
      search,
      sort = "last_interaction",
      order = "desc",
      category,
      city,
      dormant,
      limit: limitStr,
      offset: offsetStr,
    } = req.query as Record<string, string | undefined>;

    const conditions: Record<string, unknown>[] = [];

    if (status) {
      conditions.push({
        warmth_status: { in: status.split(",").map((s) => s.trim()) },
      });
    }

    if (category) {
      conditions.push({
        relationship_category: {
          in: category.split(",").map((s) => s.trim()),
        },
      });
    }

    if (city) {
      conditions.push({
        city: { contains: city, mode: "insensitive" },
      });
    }

    if (dormant === "true") {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      // Only apply "not archived" if no explicit status filter
      if (!status) {
        conditions.push({ warmth_status: { not: "archived" } });
      }
      conditions.push({
        OR: [
          { last_interaction_at: { lt: thirtyDaysAgo } },
          { last_interaction_at: null },
        ],
      });
    }

    if (search) {
      conditions.push({
        OR: [
          { full_name: { contains: search, mode: "insensitive" } },
          { nickname: { contains: search, mode: "insensitive" } },
          { occupation: { contains: search, mode: "insensitive" } },
          { company: { contains: search, mode: "insensitive" } },
          { memory_summary: { contains: search, mode: "insensitive" } },
          { what_impressed_me: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};

    // Sorting
    const dir = order === "asc" ? "asc" : "desc";
    let orderBy: Record<string, unknown>;
    switch (sort) {
      case "created_at":
        orderBy = { created_at: dir };
        break;
      case "warmth_score":
        orderBy = { warmth_score: dir };
        break;
      case "name":
        orderBy = { full_name: dir };
        break;
      default:
        orderBy =
          dir === "asc"
            ? { last_interaction_at: { sort: "asc", nulls: "first" } }
            : { last_interaction_at: { sort: "desc", nulls: "last" } };
    }

    const limit = Math.min(parseInt(limitStr || "20", 10) || 20, 100);
    const offset = parseInt(offsetStr || "0", 10) || 0;

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
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
          relationship_category: true,
          memory_summary: true,
          last_interaction_at: true,
          created_at: true,
        },
        orderBy,
        take: limit,
        skip: offset,
      }),
      prisma.contact.count({ where }),
    ]);

    res.json({
      contacts,
      total,
      hasMore: offset + contacts.length < total,
    });
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
    const parsed = createContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const contact = await prisma.contact.create({
      data: {
        ...parsed.data,
        warmth_status: "new",
        warmth_score: 0,
      },
    });

    res.status(201).json(contact);
  } catch (err) {
    next(err);
  }
});

// POST /api/contacts/batch
router.post("/batch", async (req, res, next) => {
  try {
    const parsed = batchActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { action, ids } = parsed.data;

    const newStatus = action === "archive" ? "archived" : "paused";
    const result = await prisma.contact.updateMany({
      where: { id: { in: ids } },
      data: { warmth_status: newStatus },
    });

    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

// PUT /api/contacts/:id
router.put("/:id", async (req, res, next) => {
  try {
    const parsed = updateContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { warmth_status, ...rest } = parsed.data;

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

// POST /api/contacts/:id/suggest-actions
router.post("/:id/suggest-actions", aiLimiter, async (req, res, next) => {
  try {
    const contactId = req.params.id as string;
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true },
    });
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    const suggestions = await suggestActions(contactId);
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

// POST /api/contacts/:id/interaction
router.post("/:id/interaction", async (req, res, next) => {
  try {
    const parsed = interactionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { type, content } = parsed.data;

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

    await prisma.contact.update({
      where: { id: req.params.id },
      data: { last_interaction_at: new Date() },
    });

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
      await prisma.contact.delete({ where: { id: req.params.id } });
      res.json({ deleted: true });
    } else {
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
