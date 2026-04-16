import { Router } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
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
import { indexContactMemoryAsync } from "../services/memory/memory-indexer";

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
      met_country,
      origin_country,
      dormant,
      limit: limitStr,
      offset: offsetStr,
    } = req.query as Record<string, string | undefined>;

    const conditions: Record<string, unknown>[] = [];

    if (status) {
      conditions.push({
        warmth_status: { in: status.split(",").map((s) => s.trim()) },
      });
    } else {
      // Hide archived contacts from the default list
      conditions.push({ warmth_status: { not: "archived" } });
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

    if (met_country) {
      conditions.push({
        met_country: { in: met_country.split(",").map((s) => s.trim()) },
      });
    }

    if (origin_country) {
      conditions.push({
        origin_country: { in: origin_country.split(",").map((s) => s.trim()) },
      });
    }

    if (dormant === "true") {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
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
          { memory_notes: { has: search } },
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
          met_country: true,
          origin_country: true,
          warmth_status: true,
          warmth_score: true,
          relationship_category: true,
          memory_summary: true,
          location_status: true,
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
    const groups = await prisma.contact.groupBy({
      by: ["warmth_status"],
      _count: true,
    });
    const counts: Record<string, number> = {};
    for (const s of statuses) {
      counts[s] = groups.find((g) => g.warmth_status === s)?._count ?? 0;
    }
    counts.all = Object.values(counts).reduce((a, b) => a + b, 0) - (counts.archived || 0);
    res.json(counts);
  } catch (err) {
    next(err);
  }
});

// GET /api/contacts/countries
router.get("/countries", async (_req, res, next) => {
  try {
    const [metGroups, originGroups] = await Promise.all([
      prisma.contact.groupBy({
        by: ["met_country"],
        where: { met_country: { not: null }, warmth_status: { not: "archived" } },
        _count: true,
      }),
      prisma.contact.groupBy({
        by: ["origin_country"],
        where: { origin_country: { not: null }, warmth_status: { not: "archived" } },
        _count: true,
      }),
    ]);

    const met: Record<string, number> = {};
    for (const g of metGroups) {
      if (g.met_country) met[g.met_country] = g._count;
    }

    const origin: Record<string, number> = {};
    for (const g of originGroups) {
      if (g.origin_country) origin[g.origin_country] = g._count;
    }

    res.json({ met, origin });
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

    const { met_date, ...createData } = parsed.data;
    const contact = await prisma.contact.create({
      data: {
        ...createData,
        ...(met_date && { met_date: new Date(met_date) }),
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
    const { warmth_status, social_links, ...rest } = parsed.data;

    // Prisma requires Prisma.JsonNull instead of plain null for JSON fields
    const updateData: Record<string, unknown> = { ...rest };
    if (social_links !== undefined) {
      updateData.social_links = social_links === null ? Prisma.JsonNull : social_links;
    }

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
      data: { ...updateData, ...(warmth_status && { warmth_status }) },
    });

    indexContactMemoryAsync(contact.id);

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

// POST /api/contacts/:id/photo — upload contact photo (stored as data URL in DB)
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP images are allowed"));
    }
  },
});

router.post("/:id/photo", photoUpload.single("photo"), async (req, res, next) => {
  try {
    const contactId = req.params.id as string;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No image file provided" });
      return;
    }

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true },
    });
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    // Store photo as data URL directly in DB — no filesystem needed
    const base64 = file.buffer.toString("base64");
    const dataUrl = `data:${file.mimetype};base64,${base64}`;

    await prisma.contact.update({
      where: { id: contactId },
      data: { photo_url: dataUrl },
    });

    res.json({ photo_url: dataUrl });
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

// PUT /api/contacts/:id/location-status
router.put("/:id/location-status", async (req, res, next) => {
  try {
    const { location_status } = req.body;
    if (!["confirmed", "not_here", null].includes(location_status)) {
      res.status(400).json({ error: "location_status must be 'confirmed', 'not_here', or null" });
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

    const updated = await prisma.contact.update({
      where: { id: req.params.id },
      data: { location_status },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
