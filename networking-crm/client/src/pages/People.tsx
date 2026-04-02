import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { getWarmthColor, getInitials, timeAgo } from "../lib/warmth";
import { useDebounce } from "../lib/useDebounce";

interface ContactListItem {
  id: string;
  full_name: string;
  nickname: string | null;
  photo_url: string | null;
  occupation: string | null;
  company: string | null;
  warmth_status: string;
  warmth_score: number;
  memory_summary: string | null;
  last_interaction_at: string | null;
  created_at: string;
}

type SortOption = "last_interaction" | "met_date" | "warmth_score";

const FILTERS = [
  { label: "Все", value: "", key: "all" },
  { label: "\u{1F534} Новые", value: "new", key: "new" },
  { label: "\u{1F7E1} Тёплые", value: "warming", key: "warming" },
  { label: "\u{1F7E2} Горячие", value: "warm", key: "warm" },
  { label: "\u{1F7E0} Остывают", value: "cooling", key: "cooling" },
  { label: "\u26AA Пауза", value: "paused", key: "paused" },
];

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Последний контакт", value: "last_interaction" },
  { label: "Дата знакомства", value: "met_date" },
  { label: "Warmth Score", value: "warmth_score" },
];

export default function People() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortOption>("last_interaction");
  const [showSort, setShowSort] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  const fetchCounts = useCallback(async () => {
    try {
      const data = await api.get<Record<string, number>>("/contacts/counts");
      setCounts(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (sort !== "last_interaction") params.set("sort", sort);
      const qs = params.toString();
      const data = await api.get<ContactListItem[]>(
        `/contacts${qs ? `?${qs}` : ""}`
      );
      setContacts(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedSearch, sort]);

  useEffect(() => {
    fetchContacts();
    fetchCounts();
  }, [fetchContacts, fetchCounts]);

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
      // transition not allowed, silently ignore
    }
  };

  return (
    <div className="flex flex-1 flex-col px-4 pt-6">
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Контакты</h1>
        <div className="flex items-center gap-2">
          {/* Sort */}
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
                    onClick={() => { setSort(o.value); setShowSort(false); }}
                    className={`w-full px-3 py-2 text-left text-sm ${sort === o.value ? "text-accent" : "text-neutral-300"} active:bg-neutral-800`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Add button */}
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
      <div className="relative mb-4">
        <svg
          className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500"
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <circle cx="11" cy="11" r="8" />
          <path strokeLinecap="round" d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Поиск контактов..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl bg-card py-3 pl-10 pr-4 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
        />
      </div>

      {/* Filter chips with counts */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {FILTERS.map((f) => {
          const count = counts[f.key] ?? 0;
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.value
                  ? "bg-accent text-white"
                  : "bg-card text-neutral-400"
              }`}
            >
              {f.label}{count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading && contacts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : contacts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="text-4xl">{"\u{1F3A4}"}</div>
          <p className="text-neutral-400">
            Запишите голосовое о первом знакомстве
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {contacts.map((c) => (
            <SwipeableCard
              key={c.id}
              contact={c}
              onTap={() => navigate(`/people/${c.id}`)}
              onArchive={() => handleArchive(c.id)}
              onPause={() => handlePause(c.id)}
            />
          ))}
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

function SwipeableCard({
  contact: c,
  onTap,
  onArchive,
  onPause,
}: {
  contact: ContactListItem;
  onTap: () => void;
  onArchive: () => void;
  onPause: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const swiping = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    swiping.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    if (dx < -10) {
      swiping.current = true;
      setOffset(Math.max(dx, -140));
    } else if (dx > 5 && offset < 0) {
      setOffset(Math.min(0, offset + dx));
    }
  };

  const handleTouchEnd = () => {
    if (offset < -70) {
      setOffset(-140);
    } else {
      setOffset(0);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Swipe actions behind card */}
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
      {/* Card */}
      <div
        className="relative flex items-center gap-3 bg-card p-3 transition-transform"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => { if (!swiping.current && offset === 0) onTap(); }}
      >
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: getWarmthColor(c.warmth_status) }}
        >
          {getInitials(c.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-white">{c.full_name}</p>
          <p className="truncate text-xs text-neutral-400">
            {[c.occupation, c.company].filter(Boolean).join(" \u00B7 ") || "\u2014"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: getWarmthColor(c.warmth_status) }}
          />
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
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
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
