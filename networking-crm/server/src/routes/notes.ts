import { Router } from "express";
import prisma from "../lib/prisma";
import { createNoteSchema, updateNoteSchema } from "../lib/validators";
import {
  parseBacklinks,
  resolveLinks,
  syncNoteLinks,
} from "../services/notes-service";
import { indexNoteAsync } from "../services/memory/memory-indexer";
import { deleteMemoryBySource } from "../services/memory/memory-service";

const router = Router();

function parseTagsCsv(v: unknown): string[] | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function hydrateLinks(noteIds: string[]) {
  if (noteIds.length === 0) return new Map<string, any[]>();
  const links = await prisma.noteLink.findMany({
    where: { from_note_id: { in: noteIds } },
    orderBy: { created_at: "asc" },
  });

  const contactIds = links
    .filter((l) => l.target_type === "contact")
    .map((l) => l.target_id);
  const linkedNoteIds = links
    .filter((l) => l.target_type === "note")
    .map((l) => l.target_id);

  const [contacts, linkedNotes] = await Promise.all([
    contactIds.length
      ? prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, full_name: true, nickname: true, photo_url: true },
        })
      : Promise.resolve([] as any[]),
    linkedNoteIds.length
      ? prisma.note.findMany({
          where: { id: { in: linkedNoteIds } },
          select: { id: true, title: true },
        })
      : Promise.resolve([] as any[]),
  ]);

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const noteById = new Map(linkedNotes.map((n) => [n.id, n]));

  const grouped = new Map<string, any[]>();
  for (const l of links) {
    const arr = grouped.get(l.from_note_id) || [];
    const enriched: any = {
      id: l.id,
      target_type: l.target_type,
      target_id: l.target_id,
      label: l.label,
    };
    if (l.target_type === "contact") {
      const c = contactById.get(l.target_id);
      if (c) enriched.target = c;
    } else if (l.target_type === "note") {
      const n = noteById.get(l.target_id);
      if (n) enriched.target = n;
    }
    arr.push(enriched);
    grouped.set(l.from_note_id, arr);
  }
  return grouped;
}

// GET /api/notes?q=&tag=&contact_id=&since=&limit=&offset=
router.get("/", async (req, res, next) => {
  try {
    const {
      q,
      tag,
      contact_id,
      since,
      limit: limitStr,
      offset: offsetStr,
    } = req.query as Record<string, string | undefined>;

    const limit = Math.min(Math.max(parseInt(limitStr || "50", 10), 1), 200);
    const offset = Math.max(parseInt(offsetStr || "0", 10), 0);

    const tags = parseTagsCsv(tag);
    const since_date = since && !isNaN(Date.parse(since)) ? new Date(since) : undefined;

    const where: Record<string, unknown> = {};
    const andClauses: Record<string, unknown>[] = [];

    if (q && q.trim()) {
      andClauses.push({
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { body: { contains: q, mode: "insensitive" as const } },
        ],
      });
    }
    if (tags && tags.length > 0) {
      andClauses.push({ tags: { hasSome: tags } });
    }
    if (since_date) {
      andClauses.push({ updated_at: { gte: since_date } });
    }
    if (contact_id) {
      const linked = await prisma.noteLink.findMany({
        where: { target_type: "contact", target_id: contact_id },
        select: { from_note_id: true },
      });
      const ids = linked.map((l) => l.from_note_id);
      if (ids.length === 0) {
        res.json({ notes: [], total: 0 });
        return;
      }
      andClauses.push({ id: { in: ids } });
    }

    if (andClauses.length > 0) where.AND = andClauses;

    const [notes, total] = await Promise.all([
      prisma.note.findMany({
        where,
        orderBy: { updated_at: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.note.count({ where }),
    ]);

    const linkMap = await hydrateLinks(notes.map((n) => n.id));
    const enriched = notes.map((n) => ({
      ...n,
      links: linkMap.get(n.id) || [],
    }));

    res.json({ notes: enriched, total });
  } catch (err) {
    next(err);
  }
});

// GET /api/notes/tags/all — list distinct tags (must come before /:id)
router.get("/tags/all", async (_req, res, next) => {
  try {
    const rows = await prisma.$queryRaw<{ tag: string }[]>`
      SELECT DISTINCT unnest(tags) AS tag FROM "Note" ORDER BY tag ASC
    `;
    res.json({ tags: rows.map((r) => r.tag) });
  } catch (err) {
    next(err);
  }
});

// GET /api/notes/:id
router.get("/:id", async (req, res, next) => {
  try {
    const note = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const linkMap = await hydrateLinks([note.id]);
    const unresolved = (await resolveLinks(parseBacklinks(note.body), { excludeNoteId: note.id }))
      .filter((r) => r.targetType === "unresolved")
      .map((r) => r.raw.target);
    res.json({
      ...note,
      links: linkMap.get(note.id) || [],
      unresolved,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/notes
router.post("/", async (req, res, next) => {
  try {
    const parsed = createNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const note = await prisma.note.create({
      data: {
        title: parsed.data.title ?? null,
        body: parsed.data.body,
        tags: parsed.data.tags ?? [],
      },
    });
    await syncNoteLinks(note.id, note.body);
    indexNoteAsync(note.id);

    const linkMap = await hydrateLinks([note.id]);
    res.status(201).json({ ...note, links: linkMap.get(note.id) || [] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notes/:id
router.put("/:id", async (req, res, next) => {
  try {
    const parsed = updateNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const existing = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.body !== undefined) data.body = parsed.data.body;
    if (parsed.data.tags !== undefined) data.tags = parsed.data.tags;

    const note = await prisma.note.update({
      where: { id: req.params.id },
      data,
    });
    if (parsed.data.body !== undefined) {
      await syncNoteLinks(note.id, note.body);
    }
    indexNoteAsync(note.id);

    const linkMap = await hydrateLinks([note.id]);
    res.json({ ...note, links: linkMap.get(note.id) || [] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notes/:id
router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.note.delete({ where: { id: req.params.id } });
    await deleteMemoryBySource("note", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
