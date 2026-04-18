import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, X, Trash2, Save } from "lucide-react";
import { api } from "../lib/api";
import {
  Note,
  NoteLink,
  NotesListResponse,
  formatNoteDate,
  renderNoteBody,
} from "../lib/notes";
import { Button, Card, EmptyState, Input, Textarea } from "../components/ui";
import { useDebounce } from "../lib/useDebounce";

export default function Notes() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notes, setNotes] = useState<Note[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [editing, setEditing] = useState<Note | "new" | null>(null);

  // Open note by ?id=X deep link (clear param once consumed).
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    let cancelled = false;
    api
      .get<Note>(`/notes/${id}`)
      .then((n) => {
        if (!cancelled) setEditing(n);
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("id");
            return next;
          },
          { replace: true },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
      if (activeTags.length > 0) params.set("tag", activeTags.join(","));
      params.set("limit", "50");
      const data = await api.get<NotesListResponse>(`/notes?${params.toString()}`);
      setNotes(data.notes);
      setTotal(data.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, activeTags]);

  const loadTags = useCallback(async () => {
    try {
      const data = await api.get<{ tags: string[] }>("/notes/tags/all");
      setAllTags(data.tags);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const toggleTag = (t: string) => {
    setActiveTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  const handleSaved = (saved: Note) => {
    setEditing(null);
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === saved.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = saved;
        return copy;
      }
      return [saved, ...prev];
    });
    loadTags();
  };

  const handleDeleted = (id: string) => {
    setEditing(null);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    loadTags();
  };

  if (editing) {
    return (
      <NoteEditor
        note={editing === "new" ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col px-4 pt-6 pb-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Память</h1>
        <Button
          size="sm"
          onClick={() => setEditing("new")}
          aria-label="Новая заметка"
        >
          <Plus size={16} className="mr-1" /> Новая
        </Button>
      </div>

      <div className="relative mb-3">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по заметкам..."
          className="pl-9"
        />
      </div>

      {allTags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {allTags.map((t) => {
            const active = activeTags.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                className={`rounded-full px-3 py-1 text-xs ring-1 transition-colors ${
                  active
                    ? "bg-accent/20 text-accent ring-accent/40"
                    : "bg-card text-neutral-400 ring-neutral-700 active:bg-card-hover"
                }`}
              >
                #{t}
              </button>
            );
          })}
          {activeTags.length > 0 && (
            <button
              onClick={() => setActiveTags([])}
              className="rounded-full px-3 py-1 text-xs text-neutral-500 underline-offset-2 hover:underline"
            >
              сбросить
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={"\u{1F9E0}"}
          title={total === 0 ? "Пока нет заметок" : "Ничего не найдено"}
          description={
            total === 0
              ? "Записывай мысли, детали о людях, идеи. Используй [[Имя]] чтобы связать заметку с контактом."
              : "Попробуй другой запрос или сбрось теги"
          }
          action={
            total === 0 ? (
              <Button onClick={() => setEditing("new")}>
                <Plus size={16} className="mr-1" /> Первая заметка
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              onOpen={() => setEditing(n)}
              onContactClick={(cid) => navigate(`/people/${cid}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCard({
  note,
  onOpen,
  onContactClick,
}: {
  note: Note;
  onOpen: () => void;
  onContactClick: (id: string) => void;
}) {
  const contactLinks = note.links.filter((l) => l.target_type === "contact");
  const preview = note.body.replace(/\s+/g, " ").slice(0, 160);

  return (
    <Card onClick={onOpen} className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-white">
          {note.title || "(без заголовка)"}
        </p>
        <span className="shrink-0 text-[10px] text-neutral-500">
          {formatNoteDate(note.updated_at)}
        </span>
      </div>
      <p className="text-xs text-neutral-400 line-clamp-3">{preview}</p>
      {(note.tags.length > 0 || contactLinks.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {note.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400"
            >
              #{t}
            </span>
          ))}
          {contactLinks.slice(0, 4).map((l) => (
            <button
              key={l.id}
              onClick={(e) => {
                e.stopPropagation();
                onContactClick(l.target_id);
              }}
              className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent active:bg-accent/20"
            >
              @{l.target?.full_name || l.label || "?"}
            </button>
          ))}
          {contactLinks.length > 4 && (
            <span className="text-[10px] text-neutral-500">
              +{contactLinks.length - 4}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

interface AutocompleteContact {
  id: string;
  full_name: string;
  nickname: string | null;
  occupation: string | null;
}

function detectBacklinkQuery(
  body: string,
  caret: number,
): { token: string; openPos: number } | null {
  if (caret <= 1) return null;
  const before = body.slice(0, caret);
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const between = before.slice(open + 2);
  if (/[\n\r\]]/.test(between)) return null;
  if (between.length > 40) return null;
  return { token: between, openPos: open };
}

function BacklinkTextarea({
  value,
  onChange,
  placeholder,
  rows,
  maxLength,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [hits, setHits] = useState<AutocompleteContact[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [active, setActive] = useState<{ token: string; openPos: number } | null>(null);
  const [loading, setLoading] = useState(false);

  // Detect open [[...
  useEffect(() => {
    if (caret == null) {
      setActive(null);
      return;
    }
    const found = detectBacklinkQuery(value, caret);
    setActive(found);
    if (!found) setHits([]);
  }, [value, caret]);

  // Fetch candidates when the token changes (debounced).
  useEffect(() => {
    if (!active) return;
    const token = active.token.trim();
    let cancelled = false;
    setHighlight(0);
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: "8" });
        if (token) params.set("search", token);
        const data = await api.get<{ contacts: AutocompleteContact[] }>(
          `/contacts?${params.toString()}`,
        );
        if (!cancelled) setHits(data.contacts || []);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active]);

  const updateCaret = () => {
    const el = ref.current;
    if (!el) return;
    setCaret(el.selectionStart);
  };

  const insertSelection = (contact: AutocompleteContact) => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const cursor = caret ?? el.selectionStart;
    const before = value.slice(0, active.openPos);
    const afterToken = value.slice(cursor);
    // If the user already has "]]" just after, don't double-close.
    const closesImmediately = afterToken.startsWith("]]");
    const insertion = `[[${contact.full_name}]]${closesImmediately ? "" : " "}`;
    const newBody = before + insertion + (closesImmediately ? afterToken.slice(2) : afterToken);
    const newCursor = before.length + insertion.length;
    onChange(newBody);
    setActive(null);
    setHits([]);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
      setCaret(newCursor);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!active || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertSelection(hits[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActive(null);
      setHits([]);
    }
  };

  const showPanel = active != null;
  const showEmpty = showPanel && !loading && hits.length === 0 && active.token.trim().length > 0;

  return (
    <div className={`relative ${className || ""}`}>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(updateCaret);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={updateCaret}
        onClick={updateCaret}
        onSelect={updateCaret}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className="min-h-[260px]"
      />
      {showPanel && (hits.length > 0 || loading || showEmpty) && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-white/10 bg-card shadow-lg">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
            {loading ? "поиск..." : `совпадения для "${active.token}"`}
          </div>
          {hits.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertSelection(c);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm ${
                i === highlight
                  ? "bg-accent/15 text-white"
                  : "text-neutral-300 active:bg-neutral-800"
              }`}
            >
              <span className="font-medium">{c.full_name}</span>
              {(c.nickname || c.occupation) && (
                <span className="text-[11px] text-neutral-500">
                  {[c.nickname && `«${c.nickname}»`, c.occupation]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </button>
          ))}
          {showEmpty && (
            <div className="px-3 py-2 text-xs text-neutral-500">
              Нет контакта с таким именем. После сохранения ссылка останется «не связанной».
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoteEditor({
  note,
  onCancel,
  onSaved,
  onDeleted,
}: {
  note: Note | null;
  onCancel: () => void;
  onSaved: (note: Note) => void;
  onDeleted: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(note?.title || "");
  const [body, setBody] = useState(note?.body || "");
  const [tagsInput, setTagsInput] = useState((note?.tags || []).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Note | null>(note);

  const tags = useMemo(
    () =>
      tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 30),
    [tagsInput],
  );

  const handleSave = async () => {
    if (!body.trim()) {
      setError("Заметка пустая");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { title: title.trim() || null, body, tags };
      const saved = note?.id
        ? await api.put<Note>(`/notes/${note.id}`, payload)
        : await api.post<Note>("/notes", payload);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!note?.id) return;
    if (!confirm("Удалить заметку?")) return;
    try {
      await api.del(`/notes/${note.id}`);
      onDeleted(note.id);
    } catch (err) {
      setError((err as Error).message || "Не удалось удалить");
    }
  };

  // Hot-preview the body with the original links — for existing notes only.
  // New notes just render as plain text until saved.
  const links = preview?.links || [];
  const segments = useMemo(() => renderNoteBody(body, links), [body, links]);

  useEffect(() => {
    setPreview(note);
  }, [note]);

  return (
    <div className="flex flex-1 flex-col px-4 pt-6 pb-6">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 text-sm text-neutral-400 active:text-white"
        >
          <X size={18} /> Отмена
        </button>
        <div className="flex items-center gap-2">
          {note?.id && (
            <Button variant="danger" size="sm" onClick={handleDelete}>
              <Trash2 size={14} />
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1" />
            {saving ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>
      </div>

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Заголовок (необязательно)"
        className="mb-3"
        maxLength={200}
      />

      <BacklinkTextarea
        value={body}
        onChange={setBody}
        placeholder="Мысль, деталь, идея...&#10;&#10;Используй [[Имя]] чтобы связать с контактом."
        rows={12}
        className="mb-3"
        maxLength={20000}
      />

      <Input
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="Теги через запятую (напр. idea, work)"
        className="mb-3"
      />

      {tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="mb-3 text-sm text-red-400">{error}</p>
      )}

      {body && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
            Предпросмотр
          </p>
          <Card className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">
            {segments.map((s, i) =>
              s.kind === "text" ? (
                <span key={i}>{s.text}</span>
              ) : s.resolved?.target_type === "contact" ? (
                <button
                  key={i}
                  onClick={() =>
                    s.resolved && navigate(`/people/${s.resolved.target_id}`)
                  }
                  className="mx-0.5 rounded bg-accent/15 px-1 py-0.5 text-accent"
                >
                  {s.text}
                </button>
              ) : (
                <span
                  key={i}
                  className="mx-0.5 rounded bg-neutral-800 px-1 py-0.5 text-neutral-300"
                  title="Связь не найдена — сохрани, чтобы попробовать снова"
                >
                  {s.text}
                </span>
              ),
            )}
          </Card>
          {preview?.unresolved && preview.unresolved.length > 0 && (
            <p className="mt-2 text-xs text-neutral-500">
              Не связаны: {preview.unresolved.map((u) => `[[${u}]]`).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function NoteLinkChip({
  link,
  onClick,
}: {
  link: NoteLink;
  onClick?: () => void;
}) {
  const label =
    link.target?.full_name || link.target?.title || link.label || "?";
  const kind = link.target_type === "contact" ? "@" : "§";
  return (
    <button
      onClick={onClick}
      className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent active:bg-accent/20"
    >
      {kind}
      {label}
    </button>
  );
}
