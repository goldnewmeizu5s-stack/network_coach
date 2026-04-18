import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";
import { getWarmthColor, getInitials, timeAgo } from "../lib/warmth";
import { countryCodeToFlag, getCountryLabel } from "../lib/countries";
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
  met_country: string | null;
  origin_country: string | null;
  warmth_status: string;
  warmth_score: number;
  relationship_category: string | null;
  memory_summary: string | null;
  location_status: string | null;
  last_interaction_at: string | null;
  created_at: string;
}

interface ContactsResponse {
  contacts: ContactListItem[];
  total: number;
  hasMore: boolean;
}

type SortOption = "last_interaction" | "created_at" | "warmth_score" | "name";

// ── Kanban columns (pipeline order) ──────────────────────────────
// Order matches the relationship pipeline: first-touch → developing → peak → fading.
type ColumnKey = "new" | "warming" | "warm" | "cooling";

const COLUMNS: {
  key: ColumnKey;
  label: string;
  dot: string;
  hint: string;
}[] = [
  { key: "new",     label: "Новые",    dot: "#ef4444", hint: "Первое касание" },
  { key: "warming", label: "Тёплые",   dot: "#eab308", hint: "Развиваем" },
  { key: "warm",    label: "Горячие",  dot: "#22c55e", hint: "Сильная связь" },
  { key: "cooling", label: "Остывают", dot: "#f97316", hint: "Нужно касание" },
];

// Valid column-to-column transitions (mirrors server/src/services/warmth.ts).
// Only statuses reachable from the current one appear in the move sheet.
export const VALID_MOVE: Record<ColumnKey, ColumnKey[]> = {
  new:     ["warming"],
  warming: ["warm", "new"],
  warm:    ["cooling"],
  cooling: ["warming"],
};

// Human labels for all statuses, including non-Kanban ones (paused/archived).
const STATUS_LABEL: Record<string, string> = {
  new: "Новые",
  warming: "Тёплые",
  warm: "Горячие",
  cooling: "Остывают",
  paused: "Пауза",
  archived: "Архив",
};

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

// Days since last interaction → tailwind color class (overdue highlight).
export function daysSince(date: string | null | undefined): number | null {
  if (!date) return null;
  const d = (Date.now() - new Date(date).getTime()) / 86400000;
  return isNaN(d) ? null : Math.floor(d);
}

export function getTimeColorClass(days: number | null, status: string): string {
  if (status === "paused" || status === "archived") return "text-neutral-500";
  if (days === null) return "text-neutral-500";
  if (days >= 30) return "text-red-400";
  if (days >= 14) return "text-orange-400";
  if (days >= 7)  return "text-yellow-500";
  return "text-neutral-500";
}

// Telegram haptic feedback (safe no-op if outside TMA).
function haptic(kind: "light" | "medium" | "success" = "light") {
  try {
    const hf = (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (s: string) => void } } } })
      .Telegram?.WebApp?.HapticFeedback;
    if (!hf) return;
    if (kind === "success") hf.notificationOccurred("success");
    else hf.impactOccurred(kind);
  } catch { /* ignore */ }
}

export default function People() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  // Kanban pipeline: default to first column ("new"). Empty string = legacy "all".
  const [filter, setFilter] = useState<string>("new");
  const [sort, setSort] = useState<SortOption>("last_interaction");
  const [showSort, setShowSort] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [countryFilterType, setCountryFilterType] = useState<"met" | "origin">("met");
  const [countryFilter, setCountryFilter] = useState("");
  const [countryCounts, setCountryCounts] = useState<{ met: Record<string, number>; origin: Record<string, number> }>({ met: {}, origin: {} });
  const [dormantFilter, setDormantFilter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // User location for matching
  const [userCountry, setUserCountry] = useState("");

  // Archived contacts section
  const [showArchived, setShowArchived] = useState(false);
  const [archivedContacts, setArchivedContacts] = useState<ContactListItem[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);

  // Batch selection
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Long-press quick-actions sheet target (the contact whose sheet is open).
  const [actionTarget, setActionTarget] = useState<ContactListItem | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // ── Kanban pipeline: index + directional slide ──────────────────
  // colIdx tracks which column is active; slideDir tells the list
  // animation whether to come in from the right (1) or left (-1).
  const colIdx = Math.max(
    0,
    COLUMNS.findIndex((c) => c.key === filter),
  );
  const prevColIdxRef = useRef(colIdx);
  const slideDir = colIdx >= prevColIdxRef.current ? 1 : -1;
  useEffect(() => {
    prevColIdxRef.current = colIdx;
  }, [colIdx]);

  const goToColumn = useCallback(
    (delta: 1 | -1) => {
      const next = colIdx + delta;
      if (next < 0 || next >= COLUMNS.length) return;
      haptic("light");
      setFilter(COLUMNS[next].key);
    },
    [colIdx],
  );

  const buildParams = useCallback(
    (offset = 0) => {
      const p = new URLSearchParams();
      if (filter) p.set("status", filter);
      if (debouncedSearch) p.set("search", debouncedSearch);
      if (sort !== "last_interaction") p.set("sort", sort);
      if (categoryFilter) p.set("category", categoryFilter);
      if (countryFilter) {
        p.set(countryFilterType === "met" ? "met_country" : "origin_country", countryFilter);
      }
      if (dormantFilter) p.set("dormant", "true");
      p.set("limit", "20");
      if (offset) p.set("offset", String(offset));
      return p.toString();
    },
    [filter, debouncedSearch, sort, categoryFilter, countryFilter, countryFilterType, dormantFilter]
  );

  const fetchCounts = useCallback(async () => {
    try {
      const [statusCounts, cCounts] = await Promise.all([
        api.get<Record<string, number>>("/contacts/counts"),
        api.get<{ met: Record<string, number>; origin: Record<string, number> }>("/contacts/countries"),
      ]);
      setCounts(statusCounts);
      setCountryCounts(cCounts);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchContacts = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(false);
      try {
        const data = await api.get<ContactsResponse>(
          `/contacts?${buildParams()}`,
          { signal }
        );
        setContacts(data.contacts);
        setTotal(data.total);
        setHasMore(data.hasMore);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [buildParams]
  );

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

  const fetchUserCountry = useCallback(async () => {
    try {
      const data = await api.get<{ current_country: string | null }>("/user/profile");
      setUserCountry(data.current_country || "");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchContacts(ac.signal);
    fetchCounts();
    fetchUserCountry();
    return () => ac.abort();
  }, [fetchContacts, fetchCounts, fetchUserCountry]);

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

  const fetchArchived = useCallback(async () => {
    setArchivedLoading(true);
    try {
      const data = await api.get<ContactsResponse>(
        `/contacts?status=archived&limit=100`
      );
      setArchivedContacts(data.contacts);
    } catch {
      /* ignore */
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  const toggleArchived = () => {
    if (!showArchived) {
      fetchArchived();
    }
    setShowArchived((v) => !v);
  };

  const handleArchive = async (id: string) => {
    await api.del(`/contacts/${id}`);
    setContacts((prev) => prev.filter((c) => c.id !== id));
    fetchCounts();
    // Refresh archived section if visible
    if (showArchived) fetchArchived();
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

  // Move a contact between Kanban columns via the quick-actions sheet.
  // The server validates the transition; on error we surface the reason as a toast.
  const handleMoveStatus = async (id: string, newStatus: string) => {
    try {
      await api.put(`/contacts/${id}/status`, { status: newStatus });
      haptic("success");
      show(`Перемещён в «${STATUS_LABEL[newStatus] ?? newStatus}»`);
      fetchContacts();
      fetchCounts();
    } catch (err) {
      show(err instanceof Error ? err.message : "Не удалось переместить");
    }
  };

  const handleLocationStatus = async (id: string, status: string | null) => {
    try {
      await api.put(`/contacts/${id}/location-status`, { location_status: status });
      setContacts((prev) =>
        prev.map((c) => (c.id === id ? { ...c, location_status: status } : c))
      );
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

      {/* Kanban column tabs (pipeline: new → warming → warm → cooling) */}
      <ColumnTabs
        active={filter}
        counts={counts}
        onChange={(key) => {
          if (filter !== key) haptic("light");
          setFilter(key);
        }}
      />

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

          {/* Country filter */}
          {(Object.keys(countryCounts.met).length > 0 || Object.keys(countryCounts.origin).length > 0) && (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1.5">
                <button
                  onClick={() => { setCountryFilterType("met"); setCountryFilter(""); }}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    countryFilterType === "met"
                      ? "bg-blue-600/30 text-blue-300"
                      : "bg-card text-neutral-400"
                  }`}
                >
                  Где встретились
                </button>
                <button
                  onClick={() => { setCountryFilterType("origin"); setCountryFilter(""); }}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    countryFilterType === "origin"
                      ? "bg-purple-600/30 text-purple-300"
                      : "bg-card text-neutral-400"
                  }`}
                >
                  Откуда родом
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(
                  countryFilterType === "met" ? countryCounts.met : countryCounts.origin
                )
                  .sort(([, a], [, b]) => b - a)
                  .map(([code, count]) => (
                    <button
                      key={code}
                      onClick={() => setCountryFilter(countryFilter === code ? "" : code)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        countryFilter === code
                          ? countryFilterType === "met"
                            ? "bg-blue-600/30 text-blue-300"
                            : "bg-purple-600/30 text-purple-300"
                          : "bg-card text-neutral-400"
                      }`}
                    >
                      {countryCodeToFlag(code)} {count}
                    </button>
                  ))}
              </div>
            </div>
          )}
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

      {/* List — wrapped in a motion.div so the column can slide in and
          horizontal pans switch between Kanban columns. */}
      <motion.div
        key={filter}
        initial={{ x: slideDir * 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onPanEnd={(_e, info) => {
          const { offset, velocity } = info;
          // ignore vertical scrolls and tiny jitters
          if (Math.abs(offset.x) < 60) return;
          if (Math.abs(offset.x) < Math.abs(offset.y) * 2) return;
          // require either enough travel or enough flick velocity
          if (Math.abs(offset.x) < 100 && Math.abs(velocity.x) < 300) return;
          goToColumn(offset.x < 0 ? 1 : -1);
        }}
        className="flex flex-1 flex-col"
      >
      {loading && contacts.length === 0 ? (
        <SkeletonList count={5} />
      ) : loadError ? (
        <ErrorState message="Не удалось загрузить контакты" onRetry={fetchContacts} />
      ) : contacts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          {(counts.all ?? 0) === 0 &&
          !debouncedSearch &&
          !categoryFilter &&
          !countryFilter &&
          !dormantFilter ? (
            <>
              <div className="text-4xl">{"\u{1F3A4}"}</div>
              <p className="text-neutral-400">
                Запишите голосовое о первом знакомстве
              </p>
            </>
          ) : (
            <>
              <div className="text-3xl">{"\u{1F50D}"}</div>
              <p className="text-neutral-400">
                В колонке «{COLUMNS.find((c) => c.key === filter)?.label ?? "—"}» пусто
              </p>
              <p className="text-xs text-neutral-600">
                Переключи колонку выше или сбрось фильтры
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
                userCountry={userCountry}
                onTap={() => {
                  if (selectMode) {
                    toggleSelect(c.id);
                  } else {
                    navigate(`/people/${c.id}`);
                  }
                }}
                onLongPress={() => {
                  // Long-press now opens the quick-actions sheet instead of
                  // entering select mode directly — select mode is one tap away
                  // inside the sheet.
                  if (!selectMode) {
                    haptic("medium");
                    setActionTarget(c);
                  }
                }}
                onArchive={() => handleArchive(c.id)}
                onPause={() => handlePause(c.id)}
                onLocationStatus={(status) => handleLocationStatus(c.id, status)}
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
      </motion.div>

      {/* Archived contacts section */}
      {!loading && !loadError && (counts.archived ?? 0) > 0 && (
        <div className="mt-4 mb-2">
          <button
            onClick={toggleArchived}
            className="flex w-full items-center gap-2 rounded-xl bg-card px-4 py-3 text-sm text-neutral-500 active:bg-neutral-800"
          >
            <svg
              className={`h-4 w-4 transition-transform ${showArchived ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
            </svg>
            <span>Архив</span>
            <span className="ml-auto text-xs text-neutral-600">
              {counts.archived}
            </span>
          </button>

          {showArchived && (
            <div className="mt-2 flex flex-col gap-2">
              {archivedLoading ? (
                <div className="flex justify-center py-4">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-transparent" />
                </div>
              ) : archivedContacts.length === 0 ? (
                <p className="py-3 text-center text-xs text-neutral-600">
                  Нет архивных контактов
                </p>
              ) : (
                <AnimatePresence>
                  {archivedContacts.map((c, i) => (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 0.6, y: 0 }}
                      exit={{ opacity: 0, x: 80 }}
                      transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.15) }}
                    >
                      <ContactCard
                        contact={c}
                        selected={selected.has(c.id)}
                        selectMode={selectMode}
                        userCountry={userCountry}
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
                        onLocationStatus={(status) => handleLocationStatus(c.id, status)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
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

      {/* Quick actions sheet — triggered by long-press on a card. */}
      <QuickActionsSheet
        target={actionTarget}
        onClose={() => setActionTarget(null)}
        onMove={(newStatus) => {
          if (actionTarget) handleMoveStatus(actionTarget.id, newStatus);
          setActionTarget(null);
        }}
        onPause={() => {
          if (actionTarget) handlePause(actionTarget.id);
          setActionTarget(null);
        }}
        onArchive={() => {
          if (actionTarget) handleArchive(actionTarget.id);
          setActionTarget(null);
        }}
        onSelectMultiple={() => {
          if (actionTarget) {
            setSelectMode(true);
            setSelected(new Set([actionTarget.id]));
          }
          setActionTarget(null);
        }}
      />
    </div>
  );
}

function ContactCard({
  contact: c,
  selected,
  selectMode,
  userCountry,
  onTap,
  onLongPress,
  onArchive: _onArchive,
  onPause: _onPause,
  onLocationStatus,
}: {
  contact: ContactListItem;
  selected: boolean;
  selectMode: boolean;
  userCountry: string;
  onTap: () => void;
  onLongPress: () => void;
  onArchive: () => void;
  onPause: () => void;
  onLocationStatus: (status: string | null) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  // Reset imgFailed when photo URL changes so updated photos display correctly
  useEffect(() => {
    setImgFailed(false);
  }, [c.photo_url]);

  // Card touch handling is now minimal: only a long-press timer.
  // Horizontal pans belong to the column pager above; pause/archive
  // live in the long-press action sheet (block 5).
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useRef(false);

  const handleTouchStart = () => {
    moved.current = false;
    longTimer.current = setTimeout(() => {
      onLongPress();
      longTimer.current = null;
    }, 500);
  };

  const handleTouchMove = () => {
    if (!longTimer.current && moved.current) return;
    moved.current = true;
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  };

  const warmthColor = getWarmthColor(c.warmth_status);

  // Location matching logic
  const isLocationMatch =
    userCountry &&
    c.origin_country &&
    c.origin_country.toUpperCase() === userCountry.toUpperCase() &&
    c.location_status !== "not_here";
  const isConfirmed = c.location_status === "confirmed";
  const showLocationGlow = isLocationMatch;

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        className={`relative flex items-center gap-3 rounded-2xl p-3.5 ${
          selected ? "ring-2 ring-accent border-accent/30" : ""
        }`}
        style={{
          background: showLocationGlow
            ? isConfirmed
              ? "linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(30, 30, 30, 1) 50%)"
              : "linear-gradient(135deg, rgba(251, 191, 36, 0.08) 0%, rgba(30, 30, 30, 1) 40%)"
            : "rgb(30, 30, 30)",
          border: showLocationGlow
            ? isConfirmed
              ? "1px solid rgba(251, 191, 36, 0.35)"
              : "1px solid rgba(251, 191, 36, 0.15)"
            : "1px solid rgba(255, 255, 255, 0.04)",
          boxShadow: showLocationGlow
            ? isConfirmed
              ? "0 0 24px rgba(251, 191, 36, 0.2), 0 0 8px rgba(251, 191, 36, 0.1)"
              : "0 0 16px rgba(251, 191, 36, 0.08)"
            : "none",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (!moved.current) onTap();
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

        {/* Avatar — ring only for edge states (new/cooling) or location glow.
            Neutral statuses (warming/warm/paused) get a subtle hairline border. */}
        <div className="relative">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white overflow-hidden ${
              showLocationGlow && isConfirmed ? "animate-golden-pulse" : ""
            }`}
            style={(() => {
              const isEdge = c.warmth_status === "new" || c.warmth_status === "cooling";
              const glowColor = showLocationGlow
                ? (isConfirmed ? "#fbbf24" : "#d4a017")
                : (isEdge ? warmthColor : null);
              return {
                backgroundColor: showLocationGlow
                  ? (isConfirmed ? "rgba(251, 191, 36, 0.25)" : "rgba(251, 191, 36, 0.15)")
                  : warmthColor + "22",
                color: showLocationGlow
                  ? (isConfirmed ? "#fbbf24" : "#d4a017")
                  : warmthColor,
                // Only apply a hot ring for edge states / location glow;
                // skip for animate-golden-pulse (confirmed) since the keyframes own the shadow.
                ...(glowColor && !(showLocationGlow && isConfirmed)
                  ? { boxShadow: `0 0 0 2px ${glowColor}, 0 0 10px ${glowColor}33` }
                  : {}),
                // Hairline border for non-edge states so the avatar reads as a chip.
                ...(!glowColor
                  ? { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }
                  : {}),
              };
            })()}
          >
            {c.photo_url && !imgFailed ? (
              <img
                src={c.photo_url}
                alt={c.full_name}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                onError={() => setImgFailed(true)}
              />
            ) : (
              getInitials(c.full_name)
            )}
          </div>
          {/* Location pin badge */}
          {showLocationGlow && (
            <div
              className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full"
              style={{
                background: isConfirmed
                  ? "linear-gradient(135deg, #fbbf24, #f59e0b)"
                  : "linear-gradient(135deg, #d4a017, #b8860b)",
                boxShadow: isConfirmed
                  ? "0 0 8px rgba(251, 191, 36, 0.6)"
                  : "0 0 6px rgba(212, 160, 23, 0.4)",
              }}
            >
              <svg className="h-3 w-3 text-black" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[15px] font-semibold text-white leading-tight">
              {c.full_name}
            </p>
            {(c.met_country || c.origin_country) && (
              <span className="shrink-0 text-[11px]" title={
                [
                  c.met_country && `Встреча: ${getCountryLabel(c.met_country)}`,
                  c.origin_country && `Родом: ${getCountryLabel(c.origin_country)}`,
                ].filter(Boolean).join(" | ")
              }>
                {c.met_country && countryCodeToFlag(c.met_country)}
                {c.origin_country && c.met_country !== c.origin_country && (
                  <>{" "}{countryCodeToFlag(c.origin_country)}</>
                )}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {(c.occupation || c.company) ? (
              <p className="truncate text-xs text-neutral-500">
                {[c.occupation, c.company].filter(Boolean).join(" @ ")}
              </p>
            ) : (
              // Nudge the user to enrich the contact — tapping the card still navigates.
              <p className="truncate text-xs text-neutral-600">
                <span className="text-accent/70">+</span>{" "}
                <span className="underline decoration-dotted underline-offset-2">
                  добавь описание
                </span>
              </p>
            )}
            {c.relationship_category && (
              <span
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium"
                style={{
                  backgroundColor: warmthColor + "18",
                  color: warmthColor,
                }}
              >
                {CAT_LABELS[c.relationship_category] || c.relationship_category}
              </span>
            )}
          </div>

          {/* Location match banner */}
          {showLocationGlow && (
            <div className="mt-1.5 flex items-center gap-2">
              <p
                className="text-[10px] font-medium"
                style={{
                  color: isConfirmed ? "#fbbf24" : "#d4a017",
                }}
              >
                {isConfirmed
                  ? "На месте — встретьтесь лично!"
                  : "Возможно в вашей стране"}
              </p>
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {!isConfirmed && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLocationStatus("confirmed");
                    }}
                    className="flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[9px] font-semibold transition-colors"
                    style={{
                      background: "rgba(251, 191, 36, 0.2)",
                      color: "#fbbf24",
                    }}
                    title="Подтвердить — на месте"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Да
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onLocationStatus("not_here");
                  }}
                  className="flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[9px] font-semibold transition-colors"
                  style={{
                    background: "rgba(115, 115, 115, 0.2)",
                    color: "#737373",
                  }}
                  title="Не на месте"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Нет
                </button>
              </div>
            </div>
          )}

          {/* Memory preview */}
          {c.memory_summary && !showLocationGlow && (
            <p className="mt-1 truncate text-[11px] text-neutral-400 italic">
              {c.memory_summary}
            </p>
          )}
        </div>

        {/* Right — time ago, colored by days-since-last-touch
            (yellow ≥7d, orange ≥14d, red ≥30d) so overdue contacts jump out. */}
        <div className="flex shrink-0 flex-col items-end gap-1.5 self-start pt-0.5">
          {(() => {
            const days = daysSince(c.last_interaction_at || c.created_at);
            return (
              <span
                className={`text-[10px] ${getTimeColorClass(days, c.warmth_status)}`}
              >
                {timeAgo(c.last_interaction_at || c.created_at)}
              </span>
            );
          })()}
          {showLocationGlow && isConfirmed && (
            <span className="text-[9px] font-bold" style={{ color: "#fbbf24" }}>
              РЯДОМ
            </span>
          )}
        </div>
      </div>

      {/* Top warmth strip — 3px indicator that replaces the inline WarmthBar.
          Using a top bar keeps density high while status stays scannable. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
        style={{
          backgroundColor: showLocationGlow
            ? (isConfirmed ? "#fbbf24" : "#d4a017")
            : warmthColor,
          opacity: c.warmth_status === "paused" ? 0.35 : 0.85,
        }}
      />
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
  const [metDate, setMetDate] = useState("");
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
        met_date: metDate || undefined,
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
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Дата знакомства</label>
            <input
              type="date"
              value={metDate}
              onChange={(e) => setMetDate(e.target.value)}
              className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white outline-none ring-1 ring-neutral-700 focus:ring-accent"
            />
          </div>
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

/* ────────────────────────────────────────────────────────────────
   QuickActionsSheet — bottom sheet opened by long-pressing a card.
   Offers only the status transitions that the server will accept
   (see VALID_MOVE), plus pause, archive and "select multiple".
   ──────────────────────────────────────────────────────────────── */
function QuickActionsSheet({
  target,
  onClose,
  onMove,
  onPause,
  onArchive,
  onSelectMultiple,
}: {
  target: ContactListItem | null;
  onClose: () => void;
  onMove: (newStatus: string) => void;
  onPause: () => void;
  onArchive: () => void;
  onSelectMultiple: () => void;
}) {
  if (!target) return null;

  const status = target.warmth_status as ColumnKey;
  const moves: ColumnKey[] = VALID_MOVE[status] ?? [];
  const canPause = target.warmth_status !== "paused";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-5 pb-6 pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />

        <div className="mb-5">
          <p className="truncate text-[15px] font-semibold text-white">
            {target.full_name}
          </p>
          <p className="text-xs text-neutral-500">
            Сейчас: {STATUS_LABEL[target.warmth_status] ?? target.warmth_status}
          </p>
        </div>

        {moves.length > 0 && (
          <>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Переместить в
            </p>
            <div className="mb-4 flex flex-col gap-1.5">
              {moves.map((k) => {
                const col = COLUMNS.find((c) => c.key === k);
                if (!col) return null;
                return (
                  <button
                    key={k}
                    onClick={() => onMove(k)}
                    className="flex items-center gap-3 rounded-xl bg-neutral-800 px-4 py-3 text-left text-sm text-white active:bg-neutral-700"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: col.dot,
                        boxShadow: `0 0 6px ${col.dot}`,
                      }}
                    />
                    {col.label}
                    <span className="ml-auto text-xs text-neutral-500">
                      {col.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          {canPause && (
            <button
              onClick={onPause}
              className="rounded-xl bg-neutral-800 px-4 py-3 text-left text-sm text-neutral-200 active:bg-neutral-700"
            >
              Пауза
            </button>
          )}
          <button
            onClick={onArchive}
            className="rounded-xl bg-red-600/15 px-4 py-3 text-left text-sm text-red-300 active:bg-red-600/25"
          >
            В архив
          </button>
          <button
            onClick={onSelectMultiple}
            className="rounded-xl px-4 py-3 text-left text-sm text-neutral-400 active:text-white"
          >
            Выбрать несколько
          </button>
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-3 text-center text-sm text-neutral-500 active:text-white"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   ColumnTabs — sticky pipeline tab bar
   Replaces the old chip-row filter. Each tab = one Kanban column
   with a colored dot (status color), label and count. Active tab
   gets a filled pill; inactive tabs stay muted.
   ──────────────────────────────────────────────────────────────── */
function ColumnTabs({
  active,
  counts,
  onChange,
}: {
  active: string;
  counts: Record<string, number>;
  onChange: (key: ColumnKey) => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-2 flex gap-1.5 overflow-x-auto bg-bg/95 px-4 py-2 backdrop-blur scrollbar-none">
      {COLUMNS.map((col) => {
        const isActive = active === col.key;
        const count = counts[col.key] ?? 0;
        return (
          <button
            key={col.key}
            onClick={() => onChange(col.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
              isActive
                ? "bg-neutral-800 text-white ring-1 ring-neutral-700"
                : "text-neutral-500 active:bg-neutral-900"
            }`}
            aria-pressed={isActive}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: col.dot,
                boxShadow: isActive ? `0 0 6px ${col.dot}` : "none",
              }}
            />
            {col.label}
            {count > 0 && (
              <span
                className={`tabular-nums text-[10px] ${
                  isActive ? "text-neutral-400" : "text-neutral-600"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
