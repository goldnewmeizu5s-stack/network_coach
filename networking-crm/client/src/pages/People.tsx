import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";
import { getWarmthColor, getInitials, timeAgo } from "../lib/warmth";
import { useDebounce } from "../lib/useDebounce";
import { SkeletonList } from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import { useToast } from "../components/Toast";

interface ContactListItem {
  id: string;
  full_name: string;
  nickname: string | null;
  photo_url: string | null;
  occupation: string | null;
  company: string | null;
  warmth_status: string;
  warmth_score: number;
  relationship_category: string | null;
  memory_summary: string | null;
  last_interaction_at: string | null;
  created_at: string;
}

interface ContactsResponse {
  contacts: ContactListItem[];
  total: number;
  hasMore: boolean;
}

type SortOption = "last_interaction" | "created_at" | "warmth_score" | "name";

const FILTERS = [
  { label: "Все", value: "", key: "all" },
  { label: "\u{1F534} Новые", value: "new", key: "new" },
  { label: "\u{1F7E1} Тёплые", value: "warming", key: "warming" },
  { label: "\u{1F7E2} Горячие", value: "warm", key: "warm" },
  { label: "\u{1F7E0} Остывают", value: "cooling", key: "cooling" },
  { label: "\u26AA Пауза", value: "paused", key: "paused" },
];

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "По активности", value: "last_interaction" },
  { label: "По дате встречи", value: "created_at" },
  { label: "По теплоте", value: "warmth_score" },
  { label: "По имени", value: "name" },
];

const CATEGORIES = [
  "business",
  "friendship",
  "mentor",
  "connector",
  "investor",
  "creative",
  "other",
];

const CAT_LABELS: Record<string, string> = {
  business: "бизнес",
  friendship: "дружба",
  mentor: "ментор",
  connector: "коннектор",
  investor: "инвестор",
  creative: "креатив",
  other: "другое",
};

export default function People() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortOption>("last_interaction");
  const [showSort, setShowSort] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dormantFilter, setDormantFilter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Batch selection
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const debouncedSearch = useDebounce(search, 300);

  const buildParams = useCallback(
    (offset = 0) => {
      const p = new URLSearchParams();
      if (filter) p.set("status", filter);
      if (debouncedSearch) p.set("search", debouncedSearch);
      if (sort !== "last_interaction") p.set("sort", sort);
      if (categoryFilter) p.set("category", categoryFilter);
      if (dormantFilter) p.set("dormant", "true");
      p.set("limit", "20");
      if (offset) p.set("offset", String(offset));
      return p.toString();
    },
    [filter, debouncedSearch, sort, categoryFilter, dormantFilter]
  );

  const fetchCounts = useCallback(async () => {
    try {
      setCounts(await api.get<Record<string, number>>("/contacts/counts"));
    } catch {
      /* ignore */
    }
  }, []);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.get<ContactsResponse>(
        `/contacts?${buildParams()}`
      );
      setContacts(data.contacts);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await api.get<ContactsResponse>(
        `/contacts?${buildParams(contacts.length)}`
      );
      setContacts((prev) => [...prev, ...data.contacts]);
      setHasMore(data.hasMore);
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, buildParams, contacts.length]);

  useEffect(() => {
    fetchContacts();
    fetchCounts();
  }, [fetchContacts, fetchCounts]);

  // Infinite scroll
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loadingMore) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  const handleArchive = async (id: string) => {
    await api.del(`/contacts/${id}`);
    setContacts((prev) => prev.filter((c) => c.id !== id));
    fetchCounts();
  };

  const handlePause = async (id: string) => {
    try {
      await api.put(`/contacts/${id}/status`, { status: "paused" });
      fetchContacts();
      fetchCounts();
    } catch {
      /* ignore */
    }
  };

  // Batch actions
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const batchAction = async (action: "archive" | "pause") => {
    if (selected.size === 0) return;
    try {
      await api.post("/contacts/batch", {
        action,
        ids: Array.from(selected),
      });
      show(
        action === "archive"
          ? `${selected.size} контакт(ов) архивировано`
          : `${selected.size} контакт(ов) на паузе`
      );
      setSelectMode(false);
      setSelected(new Set());
      fetchContacts();
      fetchCounts();
    } catch {
      /* ignore */
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <div className="flex flex-1 flex-col px-4 pt-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Контакты</h1>
          {total > 0 && (
            <p className="text-xs text-neutral-500">{total} всего</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowSort(!showSort)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-neutral-400 active:bg-neutral-800"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" d="M3 7h18M6 12h12M9 17h6" />
              </svg>
            </button>
            {showSort && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl bg-card py-1 shadow-lg ring-1 ring-neutral-700">
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => {
                      setSort(o.value);
                      setShowSort(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm ${sort === o.value ? "text-accent" : "text-neutral-300"} active:bg-neutral-800`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white active:bg-accent-hover"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <svg
          className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500"
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <circle cx="11" cy="11" r="8" />
          <path strokeLinecap="round" d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Поиск..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl bg-card py-2.5 pl-10 pr-4 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
        />
      </div>

      {/* Warmth filter chips */}
      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {FILTERS.map((f) => {
          const count = counts[f.key] ?? 0;
          return (
            <button
              key={f.value}
              onClick={() => setFilter(filter === f.value ? "" : f.value)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                filter === f.value
                  ? "bg-accent text-white"
                  : "bg-card text-neutral-400"
              }`}
            >
              {f.label}
              {count > 0 ? ` ${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* More filters */}
      <button
        onClick={() => setShowMoreFilters(!showMoreFilters)}
        className="mb-2 self-start text-[11px] text-neutral-500 active:text-accent"
      >
        {showMoreFilters ? "Скрыть фильтры" : "Больше фильтров"}
      </button>

      {showMoreFilters && (
        <div className="mb-3 animate-fade-in flex flex-col gap-2">
          {/* Category chips */}
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() =>
                  setCategoryFilter(categoryFilter === c ? "" : c)
                }
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  categoryFilter === c
                    ? "bg-accent text-white"
                    : "bg-card text-neutral-400"
                }`}
              >
                {CAT_LABELS[c] || c}
              </button>
            ))}
          </div>
          {/* Dormant toggle */}
          <button
            onClick={() => setDormantFilter(!dormantFilter)}
            className={`self-start rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              dormantFilter
                ? "bg-orange-600/30 text-orange-300"
                : "bg-card text-neutral-400"
            }`}
          >
            Забытые (30+ дней)
          </button>
        </div>
      )}

      {/* Batch mode bar */}
      {selectMode && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-card p-2 animate-fade-in">
          <span className="flex-1 text-xs text-neutral-400">
            Выбрано: {selected.size}
          </span>
          <button
            onClick={() => batchAction("pause")}
            className="rounded-lg bg-neutral-700 px-3 py-1.5 text-xs text-white active:bg-neutral-600"
          >
            Пауза
          </button>
          <button
            onClick={() => batchAction("archive")}
            className="rounded-lg bg-red-600/80 px-3 py-1.5 text-xs text-white active:bg-red-700"
          >
            Архив
          </button>
          <button
            onClick={exitSelectMode}
            className="rounded-lg px-2 py-1.5 text-xs text-neutral-400 active:text-white"
          >
            Отмена
          </button>
        </div>
      )}

      {/* List */}
      {loading && contacts.length === 0 ? (
        <SkeletonList count={5} />
      ) : loadError ? (
        <ErrorState message="Не удалось загрузить контакты" onRetry={fetchContacts} />
      ) : contacts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          {debouncedSearch || filter || categoryFilter || dormantFilter ? (
            <>
              <div className="text-3xl">{"\u{1F50D}"}</div>
              <p className="text-neutral-400">Никого не найдено</p>
            </>
          ) : (
            <>
              <div className="text-4xl">{"\u{1F3A4}"}</div>
              <p className="text-neutral-400">
                Запишите голосовое о первом знакомстве
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence>
          {contacts.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 80 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.15) }}
            >
              <ContactCard
                contact={c}
                selected={selected.has(c.id)}
                selectMode={selectMode}
                onTap={() => {
                  if (selectMode) {
                    toggleSelect(c.id);
                  } else {
                    navigate(`/people/${c.id}`);
                  }
                }}
                onLongPress={() => {
                  if (!selectMode) {
                    setSelectMode(true);
                    setSelected(new Set([c.id]));
                  }
                }}
                onArchive={() => handleArchive(c.id)}
                onPause={() => handlePause(c.id)}
              />
            </motion.div>
          ))}
          </AnimatePresence>
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />
          {loadingMore && (
            <div className="flex justify-center py-4">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          )}
        </div>
      )}

      {/* Add contact modal */}
      {showAddForm && (
        <AddContactModal
          onClose={() => setShowAddForm(false)}
          onCreated={(id) => {
            setShowAddForm(false);
            fetchCounts();
            navigate(`/people/${id}`);
          }}
        />
      )}
    </div>
  );
}

function ContactCard({
  contact: c,
  selected,
  selectMode,
  onTap,
  onLongPress,
  onArchive,
  onPause,
}: {
  contact: ContactListItem;
  selected: boolean;
  selectMode: boolean;
  onTap: () => void;
  onLongPress: () => void;
  onArchive: () => void;
  onPause: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const direction = useRef<"none" | "horizontal" | "vertical">("none");
  const swiping = useRef(false);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    direction.current = "none";
    swiping.current = false;
    longTimer.current = setTimeout(() => {
      onLongPress();
      longTimer.current = null;
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    // Lock direction on first significant movement
    if (direction.current === "none" && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      direction.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }

    if (direction.current !== "horizontal") return;

    if (dx < -10) {
      swiping.current = true;
      setOffset(Math.max(dx, -140));
    } else if (dx > 5 && offset < 0) {
      setOffset(Math.min(0, offset + dx));
    }
  };

  const handleTouchEnd = () => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
    direction.current = "none";
    if (offset < -70) setOffset(-140);
    else setOffset(0);
  };

  const warmthColor = getWarmthColor(c.warmth_status);

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Swipe actions */}
      <div className="absolute right-0 top-0 flex h-full items-stretch">
        <button
          onClick={onPause}
          className="flex w-[70px] items-center justify-center bg-neutral-600 text-xs font-medium text-white"
        >
          Пауза
        </button>
        <button
          onClick={onArchive}
          className="flex w-[70px] items-center justify-center bg-red-600 text-xs font-medium text-white"
        >
          Архив
        </button>
      </div>
      <div
        className={`relative flex items-center gap-3 bg-card p-3 transition-transform ${
          selected ? "ring-2 ring-accent" : ""
        }`}
        style={{ transform: `translateX(${offset}px)`, touchAction: "pan-y" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (!swiping.current && offset === 0) onTap();
        }}
      >
        {/* Select checkbox */}
        {selectMode && (
          <div
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 ${
              selected
                ? "bg-accent ring-accent"
                : "ring-neutral-600"
            }`}
          >
            {selected && (
              <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}

        {/* Avatar with warmth ring */}
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2"
          style={{
            backgroundColor: warmthColor + "33",
            color: warmthColor,
            borderColor: warmthColor,
            // ring via style to use dynamic color
            boxShadow: `0 0 0 2px ${warmthColor}`,
          }}
        >
          {getInitials(c.full_name)}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-white">
              {c.full_name}
            </p>
            {c.relationship_category && (
              <span className="shrink-0 rounded bg-neutral-700 px-1.5 py-0.5 text-[9px] text-neutral-400">
                {CAT_LABELS[c.relationship_category] || c.relationship_category}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-neutral-400">
            {[c.occupation, c.company].filter(Boolean).join(" @ ") || "\u2014"}
          </p>
          {/* Warmth bar */}
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-neutral-700">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${c.warmth_score}%`,
                backgroundColor: warmthColor,
              }}
            />
          </div>
        </div>

        {/* Right */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[10px] text-neutral-500">
            {timeAgo(c.last_interaction_at || c.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

function AddContactModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [whereMet, setWhereMet] = useState("");
  const [occupation, setOccupation] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data = await api.post<{ id: string }>("/contacts", {
        full_name: name.trim(),
        where_met: whereMet.trim() || undefined,
        occupation: occupation.trim() || undefined,
      });
      onCreated(data.id);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-neutral-600" />
        <h2 className="mb-4 text-lg font-semibold text-white">Новый контакт</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Имя *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
            autoFocus
          />
          <input
            type="text"
            placeholder="Где познакомились"
            value={whereMet}
            onChange={(e) => setWhereMet(e.target.value)}
            className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
          />
          <input
            type="text"
            placeholder="Род деятельности"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="mt-2 w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Создание..." : "Создать"}
          </button>
        </form>
      </div>
    </div>
  );
}
