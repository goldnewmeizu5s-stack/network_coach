import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import VoiceRecorder from "../components/VoiceRecorder";
import FollowUpCard from "../components/FollowUpCard";
import ErrorState from "../components/ErrorState";
import FAB from "../components/FAB";
import { api } from "../lib/api";
import { FollowUpItem } from "../lib/followups";

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

const CATEGORY_EMOJI: Record<string, string> = {
  conversation: "\u{1F5E3}\uFE0F",
  follow_up: "\u{1F91D}",
  digital: "\u{1F4F1}",
  skill: "\u{1F3AF}",
  mindset: "\u{1F9E0}",
  stretch: "\u{1F525}",
};

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
  const [todayChallenge, setTodayChallenge] = useState<{
    id: string;
    title: string;
    category: string;
    status: string;
  } | null>(null);

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

  const fetchChallenge = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<{
        challenge: {
          id: string;
          title: string;
          category: string;
          status: string;
        };
      }>("/challenges/today", { signal });
      setTodayChallenge(data.challenge);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchFollowUps(ac.signal);
    fetchStats(ac.signal);
    fetchChallenge(ac.signal);
    return () => ac.abort();
  }, [fetchFollowUps, fetchStats, fetchChallenge]);

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

      {/* ── Stats ── */}
      {stats && stats.total_contacts > 0 && (
        <motion.div className="grid grid-cols-3 gap-3" variants={item}>
          <div className="rounded-2xl border border-white/5 bg-card py-4 text-center">
            <p className="text-2xl font-bold text-white">
              {stats.total_contacts}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">Контакты</p>
          </div>
          <div
            className={`rounded-2xl border py-4 text-center ${
              stats.followups_pending > 0
                ? "border-yellow-500/10 bg-yellow-500/5"
                : "border-green-500/10 bg-green-500/5"
            }`}
          >
            <p
              className={`text-2xl font-bold ${
                stats.followups_pending > 0
                  ? "text-yellow-400"
                  : "text-green-400"
              }`}
            >
              {stats.followups_pending}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">Задачи</p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-card py-4 text-center">
            <p className="text-2xl font-bold text-white">
              {stats.streak}
              {stats.streak >= 3 ? ` \u{1F525}` : ""}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">Серия дн.</p>
          </div>
        </motion.div>
      )}

      {/* ── Challenge ── */}
      <motion.section
        className="cursor-pointer overflow-hidden rounded-2xl border border-white/5 bg-card transition-colors active:bg-card-hover"
        onClick={() => navigate("/challenges")}
        variants={item}
        whileTap={{ scale: 0.98 }}
      >
        <div className="h-[3px] bg-gradient-to-r from-accent/80 via-purple-500/60 to-transparent" />
        <div className="p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-accent/70">
            Челлендж дня
          </p>
          {todayChallenge ? (
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-lg">
                {CATEGORY_EMOJI[todayChallenge.category] || "\u2728"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {todayChallenge.title}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {todayChallenge.status === "completed"
                    ? "Выполнено"
                    : todayChallenge.status === "accepted"
                      ? "В процессе"
                      : "Нажми для подробностей"}
                </p>
              </div>
              {todayChallenge.status === "completed" ? (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500/10">
                  <svg
                    className="h-4 w-4 text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                </div>
              ) : (
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
              )}
            </div>
          ) : (
            <div className="flex animate-pulse items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/5" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-32 rounded bg-white/5" />
                <div className="h-2.5 w-20 rounded bg-white/5" />
              </div>
            </div>
          )}
        </div>
      </motion.section>

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
            <div className="mb-2 text-2xl">{"\u2728"}</div>
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
            icon: "\u2795",
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
