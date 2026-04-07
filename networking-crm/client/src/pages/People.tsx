import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";
import { getWarmthColor, getInitials, timeAgo, WARMTH_LABELS } from "../lib/warmth";
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

      {/* List */}
      {loading && contacts.length === 0 ? (
        <SkeletonList count={5} />
      ) : loadError ? (
        <ErrorState message="Не удалось загрузить контакты" onRetry={fetchContacts} />
      ) : contacts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          {debouncedSearch || filter || categoryFilter || countryFilter || dormantFilter ? (
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
        className={`relative flex items-center gap-3 p-3.5 transition-transform ${
          selected ? "ring-2 ring-accent border-accent/30" : ""
        }`}
        style={{
          transform: `translateX(${offset}px)`,
          touchAction: "pan-y",
          willChange: offset !== 0 ? "transform" : "auto",
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
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-700/60">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${c.warmth_score}%`,
                  backgroundColor: showLocationGlow
                    ? isConfirmed ? "#fbbf24" : "#d4a017"
                    : warmthColor,
                  boxShadow: showLocationGlow
                    ? isConfirmed ? "0 0 8px rgba(251, 191, 36, 0.6)" : "0 0 6px rgba(212, 160, 23, 0.4)"
                    : `0 0 6px ${warmthColor}60`,
                }}
              />
            </div>
            <span
              className="shrink-0 text-[10px] font-medium"
              style={{ color: warmthColor }}
            >
              {WARMTH_LABELS[c.warmth_status] || c.warmth_status}
            </span>
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
