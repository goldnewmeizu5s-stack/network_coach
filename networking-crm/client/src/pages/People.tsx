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
import WarmthBar from "../components/WarmthBar";

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

interface RefreshProgress {
  running: boolean;
  total: number;
  processed: number;
  failed: number;
  growthEdgesBackfilled: number;
  startedAt: string | null;
  finishedAt: string | null;
}

type SortOption = "last_interaction" | "created_at" | "warmth_score" | "name";

const FILTERS: {
  label: string;
  value: string;
  key: string;
  dot: string;
}[] = [
  { label: "Все", value: "", key: "all", dot: "#6366f1" },
  { label: "Новые", value: "new", key: "new", dot: "#ef4444" },
  { label: "Тёплые", value: "warming", key: "warming", dot: "#eab308" },
  { label: "Горячие", value: "warm", key: "warm", dot: "#22c55e" },
  { label: "Остывают", value: "cooling", key: "cooling", dot: "#f97316" },
  { label: "Пауза", value: "paused", key: "paused", dot: "#6b7280" },
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

  // Full-network refresh
  const [refresh, setRefresh] = useState<RefreshProgress | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const pollRefresh = useCallback(async () => {
    try {
      const data = await api.get<RefreshProgress>("/contacts/refresh");
      setRefresh(data);
      if (!data.running && refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Pick up an in-progress refresh when the screen opens, keep polling it.
  useEffect(() => {
    let active = true;
    api
      .get<RefreshProgress>("/contacts/refresh")
      .then((data) => {
        if (!active) return;
        setRefresh(data);
        if (data.running && !refreshTimer.current) {
          refreshTimer.current = setInterval(pollRefresh, 2000);
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      active = false;
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [pollRefresh]);

  const startRefresh = async () => {
    if (refresh?.running) return;
    try {
      const data = await api.post<RefreshProgress>("/contacts/refresh");
      setRefresh(data);
      if (!refreshTimer.current) {
        refreshTimer.current = setInterval(pollRefresh, 2000);
      }
      show("Обновление запущено — идёт в фоне");
    } catch {
      show("Не удалось запустить обновление");
    }
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
    <div className="flex flex-1 flex-col gap-4 px-4 pt-6 pb-4">
      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-white">
            Контакты
          </h1>
          {total > 0 && (
            <p className="mt-0.5 text-[13px] text-neutral-500">
              {total} всего
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowSort(!showSort)}
              aria-label="Сортировка"
              className={`flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-card text-neutral-400 transition-colors active:bg-card-hover ${
                sort !== "last_interaction" ? "text-accent" : ""
              }`}
            >
              <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M6 12h12M9 17h6" />
              </svg>
            </button>
            {showSort && (
              <div className="absolute right-0 top-full z-20 mt-1.5 w-52 overflow-hidden rounded-xl border border-white/5 bg-card py-1 shadow-xl">
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => {
                      setSort(o.value);
                      setShowSort(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors ${sort === o.value ? "text-accent" : "text-neutral-300"} active:bg-card-hover`}
                  >
                    <span>{o.label}</span>
                    {sort === o.value && (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            aria-label="Добавить контакт"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#4f46e5] text-white shadow-lg shadow-accent/20 transition-transform active:scale-95"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-500"
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <circle cx="11" cy="11" r="8" />
          <path strokeLinecap="round" d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Поиск по имени, должности..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-2xl border border-white/5 bg-card py-3 pl-10 pr-10 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/40"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            aria-label="Очистить поиск"
            className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 active:bg-white/5 active:text-white"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Warmth filter chips ── */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 scrollbar-none">
        {FILTERS.map((f) => {
          const count = counts[f.key] ?? 0;
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setFilter(active ? "" : f.value)}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all ${
                active
                  ? "border-transparent bg-white text-neutral-900 shadow-md"
                  : "border-white/5 bg-card text-neutral-300 active:bg-card-hover"
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: f.dot }}
              />
              <span>{f.label}</span>
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-semibold ${
                    active ? "bg-neutral-900/10 text-neutral-700" : "text-neutral-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── More filters toggle ── */}
      <button
        onClick={() => setShowMoreFilters(!showMoreFilters)}
        className="-mt-1 inline-flex items-center gap-1 self-start text-[11px] font-medium text-neutral-500 transition-colors active:text-accent"
      >
        <svg
          className={`h-3 w-3 transition-transform ${showMoreFilters ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
        </svg>
        {showMoreFilters ? "Скрыть фильтры" : "Больше фильтров"}
      </button>

      {showMoreFilters && (
        <div className="animate-fade-in flex flex-col gap-3 rounded-2xl border border-white/5 bg-card/50 p-3">
          {/* Category chips */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Категория
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => {
                const active = categoryFilter === c;
                return (
                  <button
                    key={c}
                    onClick={() => setCategoryFilter(active ? "" : c)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                      active
                        ? "border-accent/40 bg-accent/15 text-accent"
                        : "border-white/5 bg-white/5 text-neutral-400 active:bg-white/10"
                    }`}
                  >
                    {CAT_LABELS[c] || c}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Dormant toggle */}
          <button
            onClick={() => setDormantFilter(!dormantFilter)}
            className={`inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
              dormantFilter
                ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                : "border-white/5 bg-white/5 text-neutral-400 active:bg-white/10"
            }`}
          >
            <span>🕰</span> Забытые (30+ дней)
          </button>

          {/* Country filter */}
          {(Object.keys(countryCounts.met).length > 0 || Object.keys(countryCounts.origin).length > 0) && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                Страна
              </p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => { setCountryFilterType("met"); setCountryFilter(""); }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                    countryFilterType === "met"
                      ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                      : "border-white/5 bg-white/5 text-neutral-400 active:bg-white/10"
                  }`}
                >
                  Где встретились
                </button>
                <button
                  onClick={() => { setCountryFilterType("origin"); setCountryFilter(""); }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                    countryFilterType === "origin"
                      ? "border-purple-500/40 bg-purple-500/15 text-purple-300"
                      : "border-white/5 bg-white/5 text-neutral-400 active:bg-white/10"
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
                  .map(([code, count]) => {
                    const active = countryFilter === code;
                    return (
                      <button
                        key={code}
                        onClick={() => setCountryFilter(active ? "" : code)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium transition-all ${
                          active
                            ? countryFilterType === "met"
                              ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                              : "border-purple-500/40 bg-purple-500/15 text-purple-300"
                            : "border-white/5 bg-white/5 text-neutral-400 active:bg-white/10"
                        }`}
                      >
                        <span className="text-sm leading-none">{countryCodeToFlag(code)}</span>
                        <span className="text-neutral-500">{count}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Batch mode bar */}
      {selectMode && (
        <div className="animate-fade-in flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 p-2">
          <span className="flex-1 pl-2 text-xs text-neutral-300">
            Выбрано: <span className="font-semibold text-white">{selected.size}</span>
          </span>
          <button
            onClick={() => batchAction("pause")}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white active:bg-white/20"
          >
            Пауза
          </button>
          <button
            onClick={() => batchAction("archive")}
            className="rounded-lg bg-red-500/80 px-3 py-1.5 text-xs font-medium text-white active:bg-red-600"
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
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
          {debouncedSearch || filter || categoryFilter || countryFilter || dormantFilter ? (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-card text-3xl">
                {"\u{1F50D}"}
              </div>
              <div>
                <p className="text-sm font-medium text-white">Никого не найдено</p>
                <p className="mt-1 text-xs text-neutral-500">Попробуй изменить фильтры</p>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-gradient-to-br from-accent/20 to-transparent text-3xl">
                {"\u{1F3A4}"}
              </div>
              <div>
                <p className="text-sm font-medium text-white">Пока нет контактов</p>
                <p className="mt-1 max-w-[260px] text-xs leading-relaxed text-neutral-500">
                  Запиши голосовое о первом знакомстве — AI создаст контакт за тебя.
                </p>
              </div>
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
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />
          {loadingMore && (
            <div className="flex justify-center py-4">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          )}
        </div>
      )}

      {/* Archived contacts section */}
      {!loading && !loadError && !filter && (counts.archived ?? 0) > 0 && (
        <div>
          <button
            onClick={toggleArchived}
            className="flex w-full items-center gap-2 rounded-2xl border border-white/5 bg-card px-4 py-3 text-sm text-neutral-400 transition-colors active:bg-card-hover"
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
            <span className="font-medium">Архив</span>
            <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-xs text-neutral-500">
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

      {/* Full-network refresh — recomputes warmth/interest/growth-edge for all contacts */}
      {!loadError && (
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={startRefresh}
            disabled={refresh?.running}
            className="flex w-full items-center gap-2.5 rounded-2xl border border-white/5 bg-card px-4 py-3 text-sm text-neutral-300 transition-colors active:bg-card-hover disabled:opacity-70"
          >
            <svg
              className={`h-4 w-4 shrink-0 text-accent ${refresh?.running ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
            <span className="font-medium">
              {refresh?.running ? "Обновляю контакты…" : "Обновить все контакты"}
            </span>
            {refresh?.running && (
              <span className="ml-auto text-xs text-neutral-500">
                {refresh.processed}/{refresh.total || "?"}
              </span>
            )}
          </button>

          {refresh?.running && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${
                    refresh.total > 0
                      ? Math.round((refresh.processed / refresh.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          )}

          {refresh && !refresh.running && refresh.finishedAt ? (
            <p className="px-1 text-[11px] text-neutral-500">
              Готово · обновлено {refresh.processed} из {refresh.total}
              {refresh.growthEdgesBackfilled > 0 &&
                ` · зон роста добавлено ${refresh.growthEdgesBackfilled}`}
              {refresh.failed > 0 && ` · ошибок ${refresh.failed}`}
            </p>
          ) : (
            !refresh?.running && (
              <p className="px-1 text-[11px] leading-relaxed text-neutral-600">
                Пересчитывает теплоту, интерес и зону роста по всем контактам из
                их истории. Полезно после обновлений приложения — старые контакты
                получат новые поля.
              </p>
            )
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
  userCountry,
  onTap,
  onLongPress,
  onArchive,
  onPause,
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
  const [offset, setOffset] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);

  // Reset imgFailed when photo URL changes so updated photos display correctly
  useEffect(() => {
    setImgFailed(false);
  }, [c.photo_url]);

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
    if (direction.current === "none" && (Math.abs(dx) > 15 || Math.abs(dy) > 15)) {
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
    if (direction.current === "vertical") {
      setOffset(0);
    } else if (offset < -70) {
      setOffset(-140);
    } else {
      setOffset(0);
    }
    direction.current = "none";
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
      {/* Swipe actions */}
      <div className="absolute right-0 top-0 flex h-full items-stretch">
        <button
          onClick={onPause}
          className="flex w-[70px] flex-col items-center justify-center gap-1 bg-neutral-600 text-white"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[10px] font-medium">Пауза</span>
        </button>
        <button
          onClick={onArchive}
          className="flex w-[70px] flex-col items-center justify-center gap-1 bg-red-600 text-white"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <span className="text-[10px] font-medium">Архив</span>
        </button>
      </div>
      <div
        className={`relative flex items-center gap-3 rounded-2xl p-3.5 transition-transform ${
          selected ? "ring-2 ring-accent" : ""
        }`}
        style={{
          transform: `translateX(${offset}px)`,
          touchAction: "pan-y",
          willChange: offset !== 0 ? "transform" : "auto",
          background: showLocationGlow
            ? isConfirmed
              ? "linear-gradient(135deg, rgba(251, 191, 36, 0.18) 0%, rgba(26, 26, 26, 1) 55%)"
              : "linear-gradient(135deg, rgba(251, 191, 36, 0.09) 0%, rgba(26, 26, 26, 1) 45%)"
            : "linear-gradient(135deg, rgb(26,26,26) 0%, rgb(20,20,20) 100%)",
          border: showLocationGlow
            ? isConfirmed
              ? "1px solid rgba(251, 191, 36, 0.35)"
              : "1px solid rgba(251, 191, 36, 0.18)"
            : "1px solid rgba(255, 255, 255, 0.05)",
          boxShadow: showLocationGlow
            ? isConfirmed
              ? "0 0 24px rgba(251, 191, 36, 0.2), 0 0 8px rgba(251, 191, 36, 0.1)"
              : "0 0 16px rgba(251, 191, 36, 0.08)"
            : "0 1px 2px rgba(0,0,0,0.2)",
        }}
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

        {/* Avatar with warmth ring + glow (or golden glow for location match) */}
        <div className="relative">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white overflow-hidden ${
              showLocationGlow && isConfirmed ? "animate-golden-pulse" : ""
            }`}
            style={{
              backgroundColor: showLocationGlow
                ? isConfirmed ? "rgba(251, 191, 36, 0.25)" : "rgba(251, 191, 36, 0.15)"
                : warmthColor + "33",
              color: showLocationGlow
                ? isConfirmed ? "#fbbf24" : "#d4a017"
                : warmthColor,
              ...(!showLocationGlow || !isConfirmed ? {
                boxShadow: showLocationGlow
                  ? "0 0 0 2.5px rgba(251, 191, 36, 0.6), 0 0 12px rgba(251, 191, 36, 0.25)"
                  : `0 0 0 2.5px ${warmthColor}, 0 0 12px ${warmthColor}25`,
              } : {}),
            }}
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
            <p className="truncate text-xs text-neutral-500">
              {[c.occupation, c.company].filter(Boolean).join(" @ ") || "\u2014"}
            </p>
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
          {/* Warmth bar + label */}
          <div className="mt-2">
            <WarmthBar
              score={c.warmth_score}
              status={c.warmth_status}
              size="sm"
              glowOverride={
                showLocationGlow
                  ? {
                      color: isConfirmed ? "#fbbf24" : "#d4a017",
                      shadow: isConfirmed
                        ? "0 0 8px rgba(251, 191, 36, 0.6)"
                        : "0 0 6px rgba(212, 160, 23, 0.4)",
                    }
                  : null
              }
            />
          </div>
        </div>

        {/* Right - time + location indicator */}
        <div className="flex shrink-0 flex-col items-end gap-1.5 self-start pt-0.5">
          <span className="text-[10px] text-neutral-500">
            {timeAgo(c.last_interaction_at || c.created_at)}
          </span>
          {showLocationGlow && isConfirmed && (
            <span className="text-[9px] font-bold" style={{ color: "#fbbf24" }}>
              РЯДОМ
            </span>
          )}
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
        className="animate-slide-up w-full max-w-[430px] rounded-t-3xl border-t border-white/5 bg-card px-6 pb-8 pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-neutral-700" />
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 text-lg">
            ✨
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Новый контакт</h2>
            <p className="text-xs text-neutral-500">Заполни минимум — остальное можно добавить позже</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <input
            type="text"
            placeholder="Имя *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/50"
            autoFocus
          />
          <input
            type="text"
            placeholder="Где познакомились"
            value={whereMet}
            onChange={(e) => setWhereMet(e.target.value)}
            className="w-full rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/50"
          />
          <input
            type="text"
            placeholder="Род деятельности"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            className="w-full rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/50"
          />
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-widest text-neutral-500">Дата знакомства</label>
            <input
              type="date"
              value={metDate}
              onChange={(e) => setMetDate(e.target.value)}
              className="w-full rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent/50"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="mt-3 w-full rounded-xl bg-gradient-to-br from-accent to-[#4f46e5] py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
          >
            {saving ? "Создание..." : "Создать контакт"}
          </button>
        </form>
      </div>
    </div>
  );
}
