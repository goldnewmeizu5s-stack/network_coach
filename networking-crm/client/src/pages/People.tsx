import { useState, useEffect, useCallback } from "react";
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

const FILTERS = [
  { label: "Все", value: "" },
  { label: "\u{1F534} Новые", value: "new" },
  { label: "\u{1F7E1} Тёплые", value: "warming" },
  { label: "\u{1F7E2} Горячие", value: "warm" },
  { label: "\u{1F7E0} Остывают", value: "cooling" },
  { label: "\u26AA Пауза", value: "paused" },
];

export default function People() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const debouncedSearch = useDebounce(search, 300);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      if (debouncedSearch) params.set("search", debouncedSearch);
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
  }, [filter, debouncedSearch]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  return (
    <div className="flex flex-1 flex-col px-4 pt-6">
      {/* Search */}
      <div className="relative mb-4">
        <svg
          className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
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

      {/* Filter chips */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.value
                ? "bg-accent text-white"
                : "bg-card text-neutral-400"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Refresh */}
      <button
        onClick={fetchContacts}
        className="mb-3 self-end text-xs text-neutral-500 active:text-accent"
      >
        Обновить
      </button>

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
            <button
              key={c.id}
              onClick={() => navigate(`/people/${c.id}`)}
              className="flex items-center gap-3 rounded-2xl bg-card p-3 text-left transition-colors active:bg-neutral-800"
            >
              {/* Avatar */}
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: getWarmthColor(c.warmth_status) }}
              >
                {getInitials(c.full_name)}
              </div>
              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white">
                  {c.full_name}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {[c.occupation, c.company].filter(Boolean).join(" \u00B7 ") ||
                    "\u2014"}
                </p>
              </div>
              {/* Right side */}
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: getWarmthColor(c.warmth_status) }}
                />
                <span className="text-[10px] text-neutral-500">
                  {timeAgo(c.last_interaction_at || c.created_at)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
