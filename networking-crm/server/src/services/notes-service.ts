import prisma from "../lib/prisma";
import { logger } from "../lib/logger";

const WIKILINK_RE = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+))?\]\]/g;

export interface ParsedLink {
  /** raw text inside [[...]] before the optional pipe */
  target: string;
  /** optional display label after the pipe */
  label?: string;
}

export function parseBacklinks(body: string): ParsedLink[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: ParsedLink[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE);
  while ((m = re.exec(body)) !== null) {
    const target = (m[1] || "").trim();
    if (!target) continue;
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ target, label: m[2]?.trim() });
  }
  return out;
}

export interface ResolvedLink {
  raw: ParsedLink;
  targetType: "contact" | "note" | "unresolved";
  targetId: string | null;
}

/**
 * Resolve [[tokens]] to either a contact (by full_name or nickname, case-insensitive
 * contains), or another note (by title). Unresolved links are kept so we can still
 * render them and offer to create the missing entity later.
 */
export async function resolveLinks(
  tokens: ParsedLink[],
  opts: { excludeNoteId?: string } = {},
): Promise<ResolvedLink[]> {
  if (tokens.length === 0) return [];

  const names = tokens.map((t) => t.target);

  const [contacts, notes] = await Promise.all([
    prisma.contact.findMany({
      where: {
        OR: names.flatMap((n) => [
          { full_name: { equals: n, mode: "insensitive" as const } },
          { nickname: { equals: n, mode: "insensitive" as const } },
        ]),
      },
      select: { id: true, full_name: true, nickname: true },
    }),
    prisma.note.findMany({
      where: {
        id: opts.excludeNoteId ? { not: opts.excludeNoteId } : undefined,
        title: {
          in: names,
          mode: "insensitive" as const,
        },
      },
      select: { id: true, title: true },
    }),
  ]);

  const contactByName = new Map<string, string>();
  for (const c of contacts) {
    if (c.full_name) contactByName.set(c.full_name.toLowerCase(), c.id);
    if (c.nickname) contactByName.set(c.nickname.toLowerCase(), c.id);
  }
  const noteByTitle = new Map<string, string>();
  for (const n of notes) {
    if (n.title) noteByTitle.set(n.title.toLowerCase(), n.id);
  }

  return tokens.map((t) => {
    const key = t.target.toLowerCase();
    const contactId = contactByName.get(key);
    if (contactId) return { raw: t, targetType: "contact", targetId: contactId };
    const noteId = noteByTitle.get(key);
    if (noteId) return { raw: t, targetType: "note", targetId: noteId };
    return { raw: t, targetType: "unresolved", targetId: null };
  });
}

export async function syncNoteLinks(noteId: string, body: string): Promise<ResolvedLink[]> {
  const tokens = parseBacklinks(body);
  const resolved = await resolveLinks(tokens, { excludeNoteId: noteId });

  await prisma.noteLink.deleteMany({ where: { from_note_id: noteId } });

  const toInsert = resolved
    .filter((r) => r.targetId && r.targetType !== "unresolved")
    .map((r) => ({
      from_note_id: noteId,
      target_type: r.targetType,
      target_id: r.targetId!,
      label: r.raw.label ?? null,
    }));

  if (toInsert.length > 0) {
    try {
      await prisma.noteLink.createMany({
        data: toInsert,
        skipDuplicates: true,
      });
    } catch (err) {
      logger.error("syncNoteLinks createMany failed", {
        noteId,
        error: String(err),
      });
    }
  }

  return resolved;
}

export async function primaryContactForNote(noteId: string): Promise<string | null> {
  const link = await prisma.noteLink.findFirst({
    where: { from_note_id: noteId, target_type: "contact" },
    orderBy: { created_at: "asc" },
    select: { target_id: true },
  });
  return link?.target_id ?? null;
}
