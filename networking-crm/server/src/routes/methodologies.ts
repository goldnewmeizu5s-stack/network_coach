import { Router } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/methodologies
router.get("/", async (req, res, next) => {
  try {
    const tags = req.query.tags as string | undefined;

    const where: Record<string, unknown> = {};
    if (tags) {
      where.tags = { hasSome: tags.split(",").map((t) => t.trim()) };
    }

    const [methodologies, total] = await Promise.all([
      prisma.methodology.findMany({
        where,
        orderBy: { title: "asc" },
        select: {
          id: true,
          source: true,
          title: true,
          core_principle: true,
          tags: true,
          created_at: true,
        },
      }),
      prisma.methodology.count({ where }),
    ]);

    res.json({ methodologies, total });
  } catch (err) {
    next(err);
  }
});

// GET /api/methodologies/:id
router.get("/:id", async (req, res, next) => {
  try {
    const m = await prisma.methodology.findUnique({
      where: { id: req.params.id },
    });
    if (!m) {
      res.status(404).json({ error: "Methodology not found" });
      return;
    }
    res.json(m);
  } catch (err) {
    next(err);
  }
});

// POST /api/methodologies
router.post("/", async (req, res, next) => {
  try {
    const {
      source,
      title,
      core_principle,
      full_text,
      application_steps,
      when_to_use,
      tags,
    } = req.body;

    if (!source || !title) {
      res.status(400).json({ error: "source and title are required" });
      return;
    }

    const m = await prisma.methodology.create({
      data: {
        source,
        title,
        core_principle: core_principle || "",
        full_text: full_text || "",
        application_steps: application_steps || null,
        when_to_use: when_to_use || null,
        tags: tags || [],
      },
    });

    res.status(201).json(m);
  } catch (err) {
    next(err);
  }
});

// POST /api/methodologies/bulk
router.post("/bulk", async (req, res, next) => {
  try {
    const { methodologies } = req.body;
    if (!Array.isArray(methodologies)) {
      res.status(400).json({ error: "methodologies array is required" });
      return;
    }
    if (methodologies.length > 50) {
      res.status(400).json({ error: "Maximum 50 methodologies per import" });
      return;
    }

    let imported = 0;
    const errors: string[] = [];

    for (let i = 0; i < methodologies.length; i++) {
      const m = methodologies[i];
      if (!m.source || !m.title) {
        errors.push(`[${i}] source and title are required`);
        continue;
      }
      try {
        await prisma.methodology.create({
          data: {
            source: m.source,
            title: m.title,
            core_principle: m.core_principle || "",
            full_text: m.full_text || "",
            application_steps: m.application_steps || null,
            when_to_use: m.when_to_use || null,
            tags: m.tags || [],
          },
        });
        imported++;
      } catch (err) {
        errors.push(`[${i}] ${(err as Error).message}`);
      }
    }

    res.json({ imported, errors });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/methodologies/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.methodology.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: "Methodology not found" });
      return;
    }
    await prisma.methodology.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
