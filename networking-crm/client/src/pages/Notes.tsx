import { useCallback, useEffect, useMemo, useState } from "react";
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

  // Open note by ?id=X deep link
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    api
      .get<Note>(`/notes/${id}`)
      .then((n) => setEditing(n))
      .catch(() => {})
      .finally(() => {
        // Clear the param once consumed
        searchParams.delete("id");
        setSearchParams(searchParams, { replace: true });
      });
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

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Мысль, деталь, идея...&#10;&#10;Используй [[Имя]] чтобы связать с контактом."
        rows={12}
        className="mb-3 min-h-[260px]"
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
