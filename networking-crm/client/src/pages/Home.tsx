import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import VoiceRecorder from "../components/VoiceRecorder";
import FollowUpCard from "../components/FollowUpCard";
import ErrorState from "../components/ErrorState";
import FAB from "../components/FAB";
import RankBadge from "../components/RankBadge";
import { api } from "../lib/api";
import { FollowUpItem } from "../lib/followups";
import { RankPayload } from "../lib/rank";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 18) return "Добрый день";
  if (h >= 18 && h < 23) return "Добрый вечер";
  return "Доброй ночи";
}

function getFormattedDate(): string {
  const now = new Date();
  const day = now.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
  const weekday = now.toLocaleDateString("ru-RU", { weekday: "long" });
  return `${day}, ${weekday}`;
}

interface Stats {
  total_contacts: number;
  followups_pending: number;
  streak: number;
  most_neglected: {
    id: string;
    full_name: string;
    warmth_status: string;
    last_interaction_at: string | null;
  }[];
}

const item = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};

export default function Home() {
  const navigate = useNavigate();
  const [showRecorder, setShowRecorder] = useState(false);
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loadingFu, setLoadingFu] = useState(true);
  const [fuError, setFuError] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rank, setRank] = useState<RankPayload | null>(null);

  const fetchFollowUps = useCallback(async (signal?: AbortSignal) => {
    setLoadingFu(true);
    setFuError(false);
    try {
      const data = await api.get<FollowUpItem[]>("/followups?limit=3", {
        signal,
      });
      setFollowUps(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFuError(true);
    } finally {
      setLoadingFu(false);
    }
  }, []);

  const fetchStats = useCallback(async (signal?: AbortSignal) => {
    try {
      setStats(await api.get<Stats>("/stats", { signal }));
    } catch {
      /* ignore */
    }
  }, []);

  const fetchRank = useCallback(async (signal?: AbortSignal) => {
    try {
      setRank(await api.get<RankPayload>("/rank", { signal }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchFollowUps(ac.signal);
    fetchStats(ac.signal);
    fetchRank(ac.signal);
    return () => ac.abort();
  }, [fetchFollowUps, fetchStats, fetchRank]);

  const handleRecorderClose = useCallback(
    (contactId?: string) => {
      setShowRecorder(false);
      if (contactId) navigate(`/people/${contactId}`);
    },
    [navigate]
  );

  const handleFollowUpRemoved = (id: string) => {
    setFollowUps((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <motion.div
      className="flex flex-1 flex-col gap-6 px-4 pt-6 pb-4"
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
    >
      {/* ── Header ── */}
      <motion.div
        className="flex items-center justify-between"
        variants={item}
      >
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-white">
            {getGreeting()}
          </h1>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            {getFormattedDate()}
          </p>
        </div>
        <button
          onClick={() => navigate("/settings")}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-card text-neutral-400 transition-colors active:bg-card-hover"
          aria-label="Настройки"
        >
          <svg
            className="h-[18px] w-[18px]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7 7 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a7 7 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a7 7 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a7 7 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
          </svg>
        </button>
      </motion.div>

      {/* ── Welcome (fresh users) ── */}
      {stats && stats.total_contacts === 0 && (
        <motion.section
          className="rounded-2xl border border-white/5 bg-card p-6 text-center"
          variants={item}
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-3xl">
            {"\u{1F44B}"}
          </div>
          <h2 className="mb-2 text-lg font-semibold text-white">
            Добро пожаловать!
          </h2>
          <p className="text-sm leading-relaxed text-neutral-400">
            Запиши голосовое о первом знакомстве — расскажи, кого встретил, и AI
            создаст контакт с напоминаниями.
          </p>
        </motion.section>
      )}

      {/* ── Rank hero ── */}
      {rank && (
        <motion.button
          onClick={() => navigate("/rank")}
          variants={item}
          whileTap={{ scale: 0.98 }}
          className="relative flex w-full items-stretch gap-4 overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-card via-card to-[#141414] p-4 text-left transition-colors active:bg-card-hover"
          aria-label="Открыть профиль ранга"
        >
          {/* Background accent */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
          <div className="pointer-events-none absolute -left-12 bottom-0 h-32 w-32 rounded-full bg-yellow-500/10 blur-3xl" />

          {/* Shoulder board */}
          <div className="relative flex shrink-0 items-center justify-center">
            <RankBadge rank={rank.rank} size={130} shine />
          </div>

          {/* Text + progress */}
          <div className="relative flex min-w-0 flex-1 flex-col justify-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent/70">
              Погон нетворкера
            </p>
            <h2 className="mt-1 truncate text-lg font-bold text-white">
              {rank.rank.title}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {rank.total_xp.toLocaleString("ru-RU")} XP
            </p>

            {/* Progress to next rank */}
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-yellow-400"
                  style={{ width: `${rank.rank.progress_pct}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-neutral-500">
                <span>
                  {rank.next_rank
                    ? `След: ${rank.next_rank.short}`
                    : "Максимальный ранг"}
                </span>
                <span>
                  {rank.rank.xp_to_next !== null
                    ? `ещё ${rank.rank.xp_to_next.toLocaleString("ru-RU")} XP`
                    : ""}
                </span>
              </div>
            </div>

            {/* Mini stats row */}
            <div className="mt-3 flex items-center gap-3 text-[11px] text-neutral-400">
              <span className="inline-flex items-center gap-1">
                <span className="text-sm">🌍</span>
                {rank.handshake_world.countries} стр.
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="text-sm">👥</span>
                {rank.totals.contacts}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="text-sm">🔥</span>
                {rank.totals.streak_days} дн.
              </span>
            </div>
          </div>
        </motion.button>
      )}

      {/* ── Follow-ups ── */}
      <motion.section variants={item}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Ближайшие задачи
          </h2>
          {followUps.length > 0 && (
            <button
              onClick={() => navigate("/followups")}
              className="text-xs text-accent active:text-accent-hover"
            >
              Все &rarr;
            </button>
          )}
        </div>

        {loadingFu ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          </div>
        ) : fuError ? (
          <ErrorState
            message="Не удалось загрузить"
            onRetry={fetchFollowUps}
          />
        ) : followUps.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-card p-5 text-center">
            <div className="mb-2 text-2xl">{"✨"}</div>
            <p className="text-sm text-neutral-400">Нет активных задач</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {followUps.map((fu) => (
              <FollowUpCard
                key={fu.id}
                item={fu}
                onRemoved={handleFollowUpRemoved}
                compact
              />
            ))}
          </div>
        )}
      </motion.section>

      {/* ── Neglected contacts ── */}
      {stats && stats.most_neglected.length > 0 && (
        <motion.section variants={item}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Давно не общались
          </h2>
          <div className="flex flex-col gap-2">
            {stats.most_neglected.slice(0, 2).map((c) => {
              const days = c.last_interaction_at
                ? Math.round(
                    (Date.now() -
                      new Date(c.last_interaction_at).getTime()) /
                      86400000
                  )
                : null;
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/people/${c.id}`)}
                  className="flex items-center gap-3 rounded-2xl border border-white/5 bg-card p-3 text-left transition-colors active:bg-card-hover"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-sm font-bold text-orange-400">
                    {c.full_name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {c.full_name}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {days
                        ? `${days} дн. без контакта`
                        : "Ещё не общались"}
                    </p>
                  </div>
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5">
                    <svg
                      className="h-3.5 w-3.5 text-neutral-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.25 4.5l7.5 7.5-7.5 7.5"
                      />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        </motion.section>
      )}

      <FAB
        actions={[
          {
            icon: "\u{1F3A4}",
            label: "Записать голосовое",
            onClick: () => setShowRecorder(true),
          },
          {
            icon: "➕",
            label: "Добавить контакт",
            onClick: () => navigate("/people"),
          },
          {
            icon: "\u{1F4DD}",
            label: "Заметка",
            onClick: () => navigate("/chat"),
          },
        ]}
      />

      {showRecorder && <VoiceRecorder onClose={handleRecorderClose} />}
    </motion.div>
  );
}
