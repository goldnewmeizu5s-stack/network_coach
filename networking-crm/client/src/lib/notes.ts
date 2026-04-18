export interface NoteLink {
  id: string;
  target_type: "contact" | "note";
  target_id: string;
  label: string | null;
  target?: {
    id: string;
    full_name?: string;
    nickname?: string | null;
    photo_url?: string | null;
    title?: string | null;
  };
}

export interface Note {
  id: string;
  title: string | null;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  links: NoteLink[];
  unresolved?: string[];
}

export interface NotesListResponse {
  notes: Note[];
  total: number;
}

const WIKILINK_RE = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+))?\]\]/g;

export interface RenderedSegment {
  kind: "text" | "link";
  text: string;
  /** Label if [[target|label]], else the target */
  target?: string;
  resolved?: NoteLink;
}

export function renderNoteBody(body: string, links: NoteLink[]): RenderedSegment[] {
  if (!body) return [];
  const byLower = new Map<string, NoteLink>();
  for (const l of links) {
    const key = (l.target?.full_name || l.target?.nickname || l.target?.title || "")
      .toLowerCase();
    if (key) byLower.set(key, l);
    if (l.label) byLower.set(l.label.toLowerCase(), l);
  }

  const segments: RenderedSegment[] = [];
  let lastIdx = 0;
  const re = new RegExp(WIKILINK_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > lastIdx) {
      segments.push({ kind: "text", text: body.slice(lastIdx, m.index) });
    }
    const target = (m[1] || "").trim();
    const label = m[2]?.trim();
    const resolved = byLower.get(target.toLowerCase());
    segments.push({
      kind: "link",
      text: label || target,
      target,
      resolved,
    });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < body.length) {
    segments.push({ kind: "text", text: body.slice(lastIdx) });
  }
  return segments;
}

export function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "сегодня";
  if (diffDays === 1) return "вчера";
  if (diffDays < 7) return `${diffDays} дн. назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
