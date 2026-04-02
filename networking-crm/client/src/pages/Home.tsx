import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import VoiceRecorder from "../components/VoiceRecorder";
import FollowUpCard from "../components/FollowUpCard";
import ErrorState from "../components/ErrorState";
import FAB from "../components/FAB";
import { api } from "../lib/api";
import { FollowUpItem } from "../lib/followups";

const INSIGHT_KEY = "daily_insight_cache";

function getCachedInsight(): { text: string; date: string } | null {
  try {
    const raw = sessionStorage.getItem(INSIGHT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.date === new Date().toDateString()) return data;
  } catch {
    // ignore
  }
  return null;
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

export default function Home() {
  const navigate = useNavigate();
  const [showRecorder, setShowRecorder] = useState(false);
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loadingFu, setLoadingFu] = useState(true);
  const [fuError, setFuError] = useState(false);
  const [insight, setInsight] = useState<string | null>(
    () => getCachedInsight()?.text ?? null
  );
  const [insightLoading, setInsightLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [todayChallenge, setTodayChallenge] = useState<{
    id: string;
    title: string;
    category: string;
    status: string;
  } | null>(null);

  const fetchFollowUps = useCallback(async () => {
    setLoadingFu(true);
    setFuError(false);
    try {
      const data = await api.get<FollowUpItem[]>("/followups?limit=3");
      setFollowUps(data);
    } catch {
      setFuError(true);
    } finally {
      setLoadingFu(false);
    }
  }, []);

  const fetchInsight = useCallback(async () => {
    const cached = getCachedInsight();
    if (cached) {
      setInsight(cached.text);
      return;
    }
    setInsightLoading(true);
    try {
      const data = await api.post<{ insight: string }>("/insights/daily");
      setInsight(data.insight);
      sessionStorage.setItem(
        INSIGHT_KEY,
        JSON.stringify({ text: data.insight, date: new Date().toDateString() })
      );
    } catch {
      // ignore
    } finally {
      setInsightLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      setStats(await api.get<Stats>("/stats"));
    } catch {
      /* ignore */
    }
  }, []);

  const fetchChallenge = useCallback(async () => {
    try {
      const data = await api.get<{
        challenge: { id: string; title: string; category: string; status: string };
      }>("/challenges/today");
      setTodayChallenge(data.challenge);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchFollowUps();
    fetchInsight();
    fetchStats();
    fetchChallenge();
  }, [fetchFollowUps, fetchInsight, fetchStats, fetchChallenge]);

  const handleRecorderClose = useCallback(
    (contactId?: string) => {
      setShowRecorder(false);
      if (contactId) {
        navigate(`/people/${contactId}`);
      }
    },
    [navigate]
  );

  const handleFollowUpRemoved = (id: string) => {
    setFollowUps((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <motion.div
      className="flex flex-1 flex-col gap-5 px-4 pt-6"
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
    >
      <motion.h1
        className="text-2xl font-bold text-white"
        variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
      >
        Networking CRM
      </motion.h1>

      {/* AI Insight */}
      <motion.section
        className="rounded-2xl border border-accent/20 bg-accent/5 p-4"
        variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
      >
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
          AI-инсайт дня
        </h2>
        {insightLoading ? (
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span className="text-sm text-neutral-400">Анализирую...</span>
          </div>
        ) : insight ? (
          <p className="text-sm leading-relaxed text-neutral-200">{insight}</p>
        ) : (
          <p className="text-neutral-400">Запишите первое голосовое — и AI начнёт давать советы</p>
        )}
      </motion.section>

      {/* Today's challenge */}
      <section
        className="rounded-2xl bg-card p-4 cursor-pointer active:bg-neutral-800 transition-colors"
        onClick={() => navigate("/challenges")}
      >
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Сегодняшний челлендж
        </h2>
        {todayChallenge ? (
          <div className="flex items-center gap-3">
            <span className="text-xl">
              {
                {
                  conversation: "\u{1F5E3}\uFE0F",
                  follow_up: "\u{1F91D}",
                  digital: "\u{1F4F1}",
                  skill: "\u{1F3AF}",
                  mindset: "\u{1F9E0}",
                  stretch: "\u{1F525}",
                }[todayChallenge.category] || "\u{2728}"
              }
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {todayChallenge.title}
              </p>
              <p className="text-xs text-neutral-400">
                {todayChallenge.status === "completed"
                  ? "Сделано! \u{1F389}"
                  : todayChallenge.status === "accepted"
                    ? "В процессе..."
                    : "Нажми для подробностей"}
              </p>
            </div>
            {todayChallenge.status === "completed" ? (
              <span className="text-green-400 text-sm">{"\u2705"}</span>
            ) : (
              <span className="text-xs text-accent">&rarr;</span>
            )}
          </div>
        ) : (
          <p className="text-neutral-400">Загрузка...</p>
        )}
      </section>

      {/* Urgent follow-ups */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Срочные follow-ups
          </h2>
          {followUps.length > 0 && (
            <button
              onClick={() => navigate("/followups")}
              className="text-xs text-accent active:text-accent-hover"
            >
              Все follow-ups &rarr;
            </button>
          )}
        </div>

        {loadingFu ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : fuError ? (
          <ErrorState message="Не удалось загрузить follow-ups" onRetry={fetchFollowUps} />
        ) : followUps.length === 0 ? (
          <div className="rounded-2xl bg-card p-4 text-center">
            <span className="text-2xl">{"\u{1F389}"}</span>
            <p className="mt-1 text-sm text-neutral-400">
              Всё чисто! Нет активных задач
            </p>
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
      </section>

      {/* Stats cards */}
      {stats && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Статистика
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            <div className="shrink-0 rounded-2xl bg-card px-4 py-3">
              <p className="text-2xl font-bold text-white">
                {stats.total_contacts}
              </p>
              <p className="text-xs text-neutral-400">Контакты</p>
            </div>
            <div
              className={`shrink-0 rounded-2xl px-4 py-3 ${
                stats.followups_pending > 0
                  ? "bg-yellow-600/10"
                  : "bg-green-600/10"
              }`}
            >
              <p className="text-2xl font-bold text-white">
                {stats.followups_pending}
              </p>
              <p className="text-xs text-neutral-400">Follow-ups</p>
            </div>
            <div className="shrink-0 rounded-2xl bg-card px-4 py-3">
              <p className="text-2xl font-bold text-white">
                {stats.streak}
                {stats.streak >= 3 ? " \u{1F525}" : ""}
              </p>
              <p className="text-xs text-neutral-400">Streak дн.</p>
            </div>
          </div>
        </section>
      )}

      {/* Neglected contacts */}
      {stats && stats.most_neglected.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Забытые контакты
          </h2>
          <div className="flex flex-col gap-2">
            {stats.most_neglected.slice(0, 1).map((c) => {
              const days = c.last_interaction_at
                ? Math.round(
                    (Date.now() - new Date(c.last_interaction_at).getTime()) /
                      86400000
                  )
                : null;
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/people/${c.id}`)}
                  className="flex items-center gap-3 rounded-2xl bg-orange-600/10 p-3 text-left active:bg-orange-600/20"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-600/20 text-sm font-bold text-orange-400">
                    {c.full_name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">
                      {c.full_name}
                    </p>
                    <p className="text-xs text-orange-300/70">
                      {days ? `${days} дней без контакта` : "Ещё не общались"}
                    </p>
                  </div>
                  <span className="text-xs text-accent">Написать &rarr;</span>
                </button>
              );
            })}
          </div>
        </section>
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
