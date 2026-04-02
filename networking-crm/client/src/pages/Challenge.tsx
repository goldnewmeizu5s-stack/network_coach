import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import ErrorState from "../components/ErrorState";

interface ChallengeItem {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: number;
  status: string;
  reflection: string | null;
  rating: number | null;
  date: string;
  completed_at: string | null;
  methodology: { title: string; source: string } | null;
}

interface HistoryStats {
  completion_rate: number;
  streak: number;
  by_category: Record<string, { total: number; completed: number }>;
}

const CAT_ICONS: Record<string, string> = {
  conversation: "\u{1F5E3}\uFE0F",
  follow_up: "\u{1F91D}",
  digital: "\u{1F4F1}",
  skill: "\u{1F3AF}",
  mindset: "\u{1F9E0}",
  stretch: "\u{1F525}",
};

const CAT_LABELS: Record<string, string> = {
  conversation: "Разговор",
  follow_up: "Follow-up",
  digital: "Digital",
  skill: "Навык",
  mindset: "Мышление",
  stretch: "Вызов",
};

const CAT_COLORS: Record<string, string> = {
  conversation: "#8b5cf6",
  follow_up: "#22c55e",
  digital: "#3b82f6",
  skill: "#f59e0b",
  mindset: "#ec4899",
  stretch: "#ef4444",
};

export default function Challenge() {
  const { show } = useToast();
  const [challenges, setChallenges] = useState<ChallengeItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [history, setHistory] = useState<ChallengeItem[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [showReflection, setShowReflection] = useState(false);
  const [reflectionText, setReflectionText] = useState("");
  const [reflectionRating, setReflectionRating] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);

  // Swipe
  const touchStartX = useRef(0);

  const fetchToday = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.get<{
        challenge: ChallengeItem;
        alternatives: ChallengeItem[];
      }>("/challenges/today");
      setChallenges([data.challenge, ...(data.alternatives || [])]);
      setActiveIdx(0);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await api.get<{
        challenges: ChallengeItem[];
        stats: HistoryStats;
      }>("/challenges/history?days=7");
      setHistory(data.challenges);
      setStats(data.stats);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchToday();
    fetchHistory();
  }, [fetchToday, fetchHistory]);

  const updateStatus = async (
    id: string,
    status: string,
    extra?: { reflection?: string; rating?: number }
  ) => {
    try {
      await api.put(`/challenges/${id}`, { status, ...extra });
      setChallenges((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status } : c))
      );
      if (status === "completed") {
        const streak = stats?.streak ?? 0;
        if ((streak + 1) % 5 === 0) {
          setCelebration(
            `\u{1F389} ${streak + 1} дней подряд! Ты в ударе!`
          );
        } else {
          setCelebration("Отличная работа! \u{1F4AA}");
        }
        setTimeout(() => setCelebration(null), 3000);
        fetchHistory();
      }
      if (status === "too_hard") {
        show("Понял, подберу полегче завтра");
      }
    } catch {
      /* ignore */
    }
  };

  const handleComplete = async () => {
    const c = challenges[activeIdx];
    if (!c) return;
    await updateStatus(c.id, "completed", {
      reflection: reflectionText || undefined,
      rating: reflectionRating || undefined,
    });
    setShowReflection(false);
    setReflectionText("");
    setReflectionRating(0);
  };

  const handleSwipe = (dir: "left" | "right") => {
    if (dir === "left" && activeIdx < challenges.length - 1) {
      setActiveIdx((i) => i + 1);
    } else if (dir === "right" && activeIdx > 0) {
      setActiveIdx((i) => i - 1);
    }
  };

  const current = challenges[activeIdx];

  // Week history
  const weekDays = getWeekDays(history);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-4 px-4 pt-6">
        <div className="h-6 w-48 animate-pulse rounded bg-neutral-700" />
        <div className="h-64 animate-pulse rounded-2xl bg-card" />
        <div className="flex justify-center gap-3">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-10 w-10 animate-pulse rounded-full bg-neutral-700" />
          ))}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 px-4 pt-6">
        <ErrorState message="Не удалось загрузить челлендж" onRetry={fetchToday} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col px-4 pt-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Сегодняшний челлендж</h1>
        {stats && stats.streak > 0 && (
          <span className="rounded-full bg-orange-600/20 px-3 py-1 text-sm font-medium text-orange-400">
            {"\u{1F525}"} {stats.streak} дн.
          </span>
        )}
      </div>

      {/* Celebration overlay */}
      {celebration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
          <div className="animate-bounce-in rounded-2xl bg-card px-8 py-6 text-center shadow-lg">
            <p className="text-2xl font-bold text-white">{celebration}</p>
          </div>
        </div>
      )}

      {/* Challenge card */}
      {current ? (
        <div
          className="mb-4"
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            if (dx < -50) handleSwipe("left");
            if (dx > 50) handleSwipe("right");
          }}
        >
          <div
            className="rounded-2xl p-[2px] animate-fade-in"
            style={{
              background: `linear-gradient(135deg, ${CAT_COLORS[current.category] || "#6366f1"}40, transparent)`,
            }}
          >
            <div className="rounded-2xl bg-card p-5">
              {/* Category + difficulty */}
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-300">
                  <span>{CAT_ICONS[current.category] || "\u{2728}"}</span>
                  {CAT_LABELS[current.category] || current.category}
                </span>
                <DifficultyDots value={current.difficulty} />
              </div>

              {/* Title */}
              <h2 className="mb-2 text-lg font-bold text-white">
                {current.title}
              </h2>

              {/* Description */}
              <p className="mb-4 text-sm leading-relaxed text-neutral-300">
                {current.description}
              </p>

              {/* Methodology badge */}
              {current.methodology && (
                <div className="mb-4 flex items-center gap-1.5">
                  <span className="rounded-full bg-neutral-700 px-2.5 py-1 text-[10px] text-neutral-400">
                    По методу: {current.methodology.source}
                  </span>
                </div>
              )}

              {/* Actions */}
              {current.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => updateStatus(current.id, "accepted")}
                    className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover"
                  >
                    Принять {"\u{1F4AA}"}
                  </button>
                  <button
                    onClick={() =>
                      handleSwipe(
                        activeIdx < challenges.length - 1 ? "left" : "right"
                      )
                    }
                    className="rounded-xl bg-neutral-700 px-4 py-3 text-sm font-medium text-neutral-300 active:bg-neutral-600"
                  >
                    {"\u{1F504}"}
                  </button>
                  <button
                    onClick={() => updateStatus(current.id, "too_hard")}
                    className="rounded-xl bg-red-900/30 px-4 py-3 text-sm font-medium text-red-400 active:bg-red-900/50"
                  >
                    {"\u{1F630}"}
                  </button>
                </div>
              )}

              {current.status === "accepted" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowReflection(true)}
                    className="flex-1 rounded-xl bg-green-600 py-3 text-sm font-medium text-white active:bg-green-700"
                  >
                    Выполнено {"\u2705"}
                  </button>
                  <button
                    onClick={() => updateStatus(current.id, "skipped")}
                    className="rounded-xl bg-neutral-700 px-4 py-3 text-sm font-medium text-neutral-400 active:bg-neutral-600"
                  >
                    Не вышло
                  </button>
                </div>
              )}

              {current.status === "completed" && (
                <div className="rounded-xl bg-green-600/10 py-3 text-center text-sm font-medium text-green-400">
                  Выполнено! {"\u{1F389}"}
                  {current.rating && (
                    <span className="ml-2">
                      {"★".repeat(current.rating)}
                      {"☆".repeat(5 - current.rating)}
                    </span>
                  )}
                </div>
              )}

              {(current.status === "skipped" ||
                current.status === "too_hard") && (
                <div className="rounded-xl bg-neutral-800 py-3 text-center text-sm text-neutral-500">
                  {current.status === "skipped" ? "Пропущено" : "Слишком сложно"}
                </div>
              )}
            </div>
          </div>

          {/* Dots indicator */}
          {challenges.length > 1 && (
            <div className="mt-3 flex justify-center gap-1.5">
              {challenges.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveIdx(i)}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    i === activeIdx ? "bg-accent" : "bg-neutral-600"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-4 rounded-2xl bg-card p-6 text-center">
          <p className="text-neutral-400">Нет челленджа на сегодня</p>
        </div>
      )}

      {/* Week history */}
      <section className="mb-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Эта неделя
        </h3>
        <div className="flex justify-between">
          {weekDays.map((d) => (
            <div key={d.label} className="flex flex-col items-center gap-1">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full text-sm ${
                  d.status === "completed"
                    ? "bg-green-600/20 text-green-400"
                    : d.status === "skipped"
                      ? "bg-neutral-700 text-neutral-500"
                      : d.status === "too_hard"
                        ? "bg-red-600/20 text-red-400"
                        : d.status === "accepted"
                          ? "bg-accent/20 text-accent"
                          : "bg-neutral-800 text-neutral-600"
                }`}
              >
                {d.status === "completed"
                  ? "\u2705"
                  : d.status === "skipped"
                    ? "\u23ED"
                    : d.status === "too_hard"
                      ? "\u{1F630}"
                      : d.status === "accepted"
                        ? "\u{1F4AA}"
                        : "\u2B1C"}
              </div>
              <span className="text-[10px] text-neutral-500">{d.label}</span>
            </div>
          ))}
        </div>
        {stats && (
          <p className="mt-2 text-center text-xs text-neutral-500">
            Выполнено{" "}
            {history.filter((h) => h.status === "completed").length} из{" "}
            {history.length} на этой неделе
          </p>
        )}
      </section>

      {/* Stats toggle */}
      <button
        onClick={() => setShowStats(!showStats)}
        className="mb-3 self-start text-xs text-neutral-500 active:text-accent"
      >
        {showStats ? "Скрыть статистику" : "Статистика"}
      </button>

      {showStats && stats && (
        <section className="animate-fade-in mb-4 rounded-2xl bg-card p-4">
          {/* Completion rate */}
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-neutral-500">Выполнение</span>
              <span className="text-xs font-medium text-white">
                {stats.completion_rate}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-700">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${stats.completion_rate}%` }}
              />
            </div>
          </div>

          {/* By category */}
          {Object.entries(stats.by_category).map(([cat, data]) => {
            const rate =
              data.total > 0
                ? Math.round((data.completed / data.total) * 100)
                : 0;
            return (
              <div key={cat} className="mb-2 flex items-center justify-between">
                <span className="text-xs text-neutral-400">
                  {CAT_ICONS[cat] || ""} {CAT_LABELS[cat] || cat}
                </span>
                <span
                  className={`text-xs font-medium ${
                    rate >= 70
                      ? "text-green-400"
                      : rate >= 40
                        ? "text-yellow-400"
                        : "text-red-400"
                  }`}
                >
                  {rate}% ({data.completed}/{data.total})
                </span>
              </div>
            );
          })}

          <div className="mt-3 border-t border-neutral-700 pt-3">
            <p className="text-xs text-neutral-400">
              Текущий streak: {stats.streak} дн. {stats.streak >= 3 ? "\u{1F525}" : ""}
            </p>
          </div>
        </section>
      )}

      {/* Reflection bottom sheet */}
      {showReflection && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => setShowReflection(false)}
        >
          <div
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
            <h3 className="mb-4 text-lg font-semibold text-white">
              Как прошло?
            </h3>

            {/* Rating */}
            <div className="mb-4 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setReflectionRating(star)}
                  className={`text-3xl transition-transform active:scale-110 ${
                    star <= reflectionRating
                      ? "text-yellow-400"
                      : "text-neutral-600"
                  }`}
                >
                  {star <= reflectionRating ? "\u2605" : "\u2606"}
                </button>
              ))}
            </div>

            {/* Reflection text */}
            <textarea
              value={reflectionText}
              onChange={(e) => setReflectionText(e.target.value)}
              placeholder="Что заметил/узнал? (опционально)"
              rows={3}
              className="mb-4 w-full resize-none rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
            />

            <button
              onClick={handleComplete}
              className="w-full rounded-xl bg-green-600 py-3 text-sm font-medium text-white active:bg-green-700"
            >
              Готово {"\u{1F389}"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DifficultyDots({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i < value ? "bg-accent" : "bg-neutral-700"
          }`}
        />
      ))}
    </div>
  );
}

function getWeekDays(
  history: ChallengeItem[]
): { label: string; status: string }[] {
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const now = new Date();
  const monday = new Date(now);
  const dayOfWeek = now.getDay() || 7;
  monday.setDate(now.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);

  return days.map((label, i) => {
    const dayStart = new Date(monday.getTime() + i * 86400000);
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    // Find the "best" status for this day (completed > accepted > skipped > too_hard > pending)
    const dayChallenge = history.find((h) => {
      const d = new Date(h.date);
      return d >= dayStart && d < dayEnd;
    });

    return {
      label,
      status: dayChallenge?.status || (dayStart <= now ? "pending" : ""),
    };
  });
}
