import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import ErrorState from "../components/ErrorState";
import LocationContextModal from "../components/LocationContextModal";

const fade = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};

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
  is_location_based?: boolean;
  location_context?: string | null;
  context_tags?: string[];
  dating_flavor?: boolean;
}

interface HistoryStats {
  completion_rate: number;
  streak: number;
  by_category: Record<string, { total: number; completed: number }>;
}

const CAT_ICONS: Record<string, string> = {
  conversation: "\u{1F5E3}️",
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

type DayStatus = "completed" | "skipped" | "too_hard" | "accepted" | "pending" | "future";

function getDayStyle(status: string): {
  bg: string;
  text: string;
  glyph: string;
} {
  switch (status as DayStatus) {
    case "completed":
      return {
        bg: "bg-emerald-500/20 ring-1 ring-emerald-500/30",
        text: "text-emerald-300",
        glyph: "✓",
      };
    case "accepted":
      return {
        bg: "bg-accent/20 ring-1 ring-accent/30",
        text: "text-accent",
        glyph: "●",
      };
    case "too_hard":
      return {
        bg: "bg-red-500/15 ring-1 ring-red-500/25",
        text: "text-red-300",
        glyph: "!",
      };
    case "skipped":
      return {
        bg: "bg-white/[0.04]",
        text: "text-neutral-500",
        glyph: "–",
      };
    case "pending":
      return {
        bg: "bg-white/[0.04]",
        text: "text-neutral-600",
        glyph: "·",
      };
    default:
      return {
        bg: "bg-white/[0.02]",
        text: "text-neutral-700",
        glyph: "",
      };
  }
}

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
  const [actionBusy, setActionBusy] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);

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
    if (actionBusy) return;
    setActionBusy(true);
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
    } finally {
      setActionBusy(false);
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
        <div className="h-7 w-48 animate-pulse rounded bg-neutral-800" />
        <div className="h-80 animate-pulse rounded-3xl bg-card" />
        <div className="flex justify-between">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-11 w-11 animate-pulse rounded-xl bg-card" />
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

  const catColor = current
    ? CAT_COLORS[current.category] || "#6366f1"
    : "#6366f1";
  const completedCount = weekDays.filter(
    (d) => d.status === "completed"
  ).length;
  const passedCount = weekDays.filter((d) => d.status !== "future").length;

  return (
    <motion.div
      className="flex flex-1 flex-col gap-5 px-4 pt-6 pb-4"
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
    >
      {/* ── Header ── */}
      <motion.div className="flex items-end justify-between" variants={fade}>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-white">
            Челлендж дня
          </h1>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            Ежедневная тренировка нетворкера
          </p>
        </div>
        {stats && stats.streak > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-orange-500/25 bg-gradient-to-br from-orange-500/15 to-orange-500/5 px-3 py-1.5">
            <span className="text-base leading-none">{"\u{1F525}"}</span>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold text-orange-300">
                {stats.streak}
              </span>
              <span className="mt-0.5 text-[9px] uppercase tracking-widest text-orange-300/70">
                дней
              </span>
            </div>
          </div>
        )}
      </motion.div>

      {/* ── Location CTA ── */}
      <motion.button
        variants={fade}
        onClick={() => setLocationModalOpen(true)}
        className="flex items-center gap-3 rounded-2xl border border-white/5 bg-card px-3.5 py-2.5 text-left transition-colors active:bg-card-hover"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-sm">
          {"\u{1F4CD}"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-neutral-200">
            Я в другом месте
          </p>
          <p className="text-[11px] text-neutral-500">
            Подобрать челлендж под локацию
          </p>
        </div>
        <svg
          className="h-4 w-4 shrink-0 text-neutral-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </motion.button>

      {/* ── Celebration overlay ── */}
      {celebration && (
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="animate-bounce-in relative mx-6 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-accent/20 via-card to-[#141414] px-8 py-8 text-center shadow-2xl">
            <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent/25 blur-3xl" />
            <div className="pointer-events-none absolute -left-10 bottom-0 h-32 w-32 rounded-full bg-yellow-500/20 blur-3xl" />
            <p className="relative text-2xl font-bold text-white">
              {celebration}
            </p>
          </div>
        </div>
      )}

      {/* ── Challenge card ── */}
      {current ? (
        <motion.section variants={fade} className="flex flex-col gap-3">
          <div
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
              className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-card via-card to-[#141414] p-5"
              style={{ borderColor: catColor + "33" }}
            >
              {/* Ambient glows */}
              <div
                className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full blur-3xl"
                style={{ backgroundColor: catColor + "22" }}
              />
              <div
                className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full blur-3xl"
                style={{ backgroundColor: catColor + "11" }}
              />

              <div className="relative">
                {/* Category chip + difficulty */}
                <div className="mb-4 flex items-center justify-between">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest"
                    style={{
                      borderColor: catColor + "40",
                      backgroundColor: catColor + "18",
                      color: catColor,
                    }}
                  >
                    <span className="text-sm leading-none">
                      {CAT_ICONS[current.category] || "\u{2728}"}
                    </span>
                    <span>
                      {CAT_LABELS[current.category] || current.category}
                    </span>
                  </span>
                  <DifficultyDots value={current.difficulty} color={catColor} />
                </div>

                {/* Location + dating badges */}
                {(current.is_location_based || current.dating_flavor) && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {current.is_location_based && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                        <span>{"\u{1F4CD}"}</span> под локацию
                      </span>
                    )}
                    {current.dating_flavor && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-pink-500/25 bg-pink-500/10 px-2 py-0.5 text-[10px] font-medium text-pink-300">
                        <span>{"\u{1F495}"}</span> нативное знакомство
                      </span>
                    )}
                  </div>
                )}

                {/* Title */}
                <h2 className="mb-2 text-[19px] font-bold leading-tight text-white">
                  {current.title}
                </h2>

                {/* Description */}
                <p className="mb-4 text-sm leading-relaxed text-neutral-300">
                  {current.description}
                </p>

                {/* Methodology badge */}
                {current.methodology && (
                  <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-white/5 px-2.5 py-1 text-[10px] text-neutral-400">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                    По методу: {current.methodology.source}
                  </div>
                )}

                {/* Actions */}
                {current.status === "pending" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateStatus(current.id, "accepted")}
                      disabled={actionBusy}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-accent to-[#4f46e5] py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-transform active:scale-[0.98] disabled:opacity-50"
                    >
                      <span>{"\u{1F4AA}"}</span> Принять
                    </button>
                    <button
                      onClick={() =>
                        handleSwipe(
                          activeIdx < challenges.length - 1 ? "left" : "right"
                        )
                      }
                      aria-label="Другой челлендж"
                      className="flex h-[46px] w-[46px] items-center justify-center rounded-xl border border-white/5 bg-card text-neutral-300 transition-colors active:bg-card-hover"
                    >
                      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356m-16.03 5.22h4.992m11.04 5.244h4.992v4.992M3.97 14.572h4.992v4.992M8.962 4.356v4.992H3.97l7.052-7.052M15.038 19.644v-4.992h4.992l-7.052 7.052" />
                      </svg>
                    </button>
                    <button
                      onClick={() => updateStatus(current.id, "too_hard")}
                      disabled={actionBusy}
                      aria-label="Слишком сложно"
                      className="flex h-[46px] w-[46px] items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 transition-colors active:bg-red-500/20 disabled:opacity-50"
                    >
                      <span className="text-base">{"\u{1F630}"}</span>
                    </button>
                  </div>
                )}

                {current.status === "accepted" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowReflection(true)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition-transform active:scale-[0.98]"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Выполнено
                    </button>
                    <button
                      onClick={() => updateStatus(current.id, "skipped")}
                      className="rounded-xl border border-white/5 bg-card px-4 py-3 text-sm font-medium text-neutral-400 transition-colors active:bg-card-hover"
                    >
                      Не вышло
                    </button>
                  </div>
                )}

                {current.status === "completed" && (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 py-3 text-sm font-semibold text-emerald-300">
                    <span>{"\u{1F389}"}</span> Выполнено!
                    {current.rating && (
                      <span className="ml-1 text-yellow-400">
                        {"★".repeat(current.rating)}
                        <span className="text-yellow-400/30">
                          {"★".repeat(5 - current.rating)}
                        </span>
                      </span>
                    )}
                  </div>
                )}

                {(current.status === "skipped" ||
                  current.status === "too_hard") && (
                  <div className="rounded-xl border border-white/5 bg-white/[0.03] py-3 text-center text-sm text-neutral-500">
                    {current.status === "skipped"
                      ? "Пропущено"
                      : "Слишком сложно"}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Dots indicator */}
          {challenges.length > 1 && (
            <div className="flex items-center justify-center gap-1.5">
              {challenges.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveIdx(i)}
                  aria-label={`Вариант ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${
                    i === activeIdx
                      ? "w-6 bg-accent"
                      : "w-1.5 bg-neutral-700 active:bg-neutral-500"
                  }`}
                />
              ))}
            </div>
          )}
        </motion.section>
      ) : (
        <motion.div
          variants={fade}
          className="flex flex-col items-center gap-3 rounded-3xl border border-white/5 bg-card p-8 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-2xl">
            {"\u{1F331}"}
          </div>
          <p className="text-sm text-neutral-400">Нет челленджа на сегодня</p>
        </motion.div>
      )}

      {/* ── Week history ── */}
      <motion.section variants={fade}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Эта неделя
          </h3>
          {stats && passedCount > 0 && (
            <span className="text-[11px] text-neutral-500 tabular-nums">
              {completedCount} из {passedCount}
            </span>
          )}
        </div>
        <div className="flex justify-between gap-1 rounded-2xl border border-white/5 bg-card p-3">
          {weekDays.map((d) => {
            const style = getDayStyle(d.status);
            return (
              <div
                key={d.label}
                className="flex flex-1 flex-col items-center gap-1.5"
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-semibold transition-colors ${style.bg} ${style.text} ${
                    d.isToday ? "ring-2 ring-accent/60" : ""
                  }`}
                >
                  {style.glyph}
                </div>
                <span
                  className={`text-[10px] font-medium ${
                    d.isToday ? "text-white" : "text-neutral-500"
                  }`}
                >
                  {d.label}
                </span>
              </div>
            );
          })}
        </div>
      </motion.section>

      {/* ── Stats toggle ── */}
      <motion.button
        variants={fade}
        onClick={() => setShowStats(!showStats)}
        className="-mt-1 inline-flex items-center gap-1 self-start text-[11px] font-medium text-neutral-500 transition-colors active:text-accent"
      >
        <svg
          className={`h-3 w-3 transition-transform ${showStats ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
        </svg>
        {showStats ? "Скрыть статистику" : "Подробная статистика"}
      </motion.button>

      {showStats && stats && (
        <motion.section
          variants={fade}
          className="animate-fade-in flex flex-col gap-3 rounded-2xl border border-white/5 bg-card p-4"
        >
          {/* Completion rate */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-widest text-neutral-500">
                Общее выполнение
              </span>
              <span className="text-sm font-bold text-white tabular-nums">
                {stats.completion_rate}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-400 transition-all"
                style={{ width: `${stats.completion_rate}%` }}
              />
            </div>
          </div>

          {/* By category */}
          {Object.keys(stats.by_category).length > 0 && (
            <div className="mt-1 flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-widest text-neutral-500">
                По категориям
              </p>
              {Object.entries(stats.by_category).map(([cat, data]) => {
                const rate =
                  data.total > 0
                    ? Math.round((data.completed / data.total) * 100)
                    : 0;
                const color = CAT_COLORS[cat] || "#6366f1";
                return (
                  <div key={cat}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs text-neutral-300">
                        <span>{CAT_ICONS[cat] || ""}</span>
                        {CAT_LABELS[cat] || cat}
                      </span>
                      <span className="text-[11px] font-semibold tabular-nums text-neutral-400">
                        {data.completed}/{data.total}
                        <span className="ml-1 text-neutral-600">{rate}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${rate}%`,
                          backgroundColor: color,
                          boxShadow: `0 0 8px ${color}40`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Streak summary */}
          <div className="mt-1 flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/15 text-base">
              {"\u{1F525}"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">
                {stats.streak} дн. подряд
              </p>
              <p className="text-[11px] text-neutral-500">
                {stats.streak >= 5
                  ? "Ты в ударе — держи темп"
                  : stats.streak >= 3
                    ? "Хороший ритм, не сбивайся"
                    : "Каждый день — плюс один"}
              </p>
            </div>
          </div>
        </motion.section>
      )}

      {/* Location context modal */}
      {locationModalOpen && (
        <LocationContextModal
          onClose={() => setLocationModalOpen(false)}
          onDone={() => {
            fetchToday();
            fetchHistory();
          }}
        />
      )}

      {/* ── Reflection bottom sheet ── */}
      {showReflection && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
          onClick={() => setShowReflection(false)}
        >
          <div
            className="animate-slide-up w-full max-w-[430px] rounded-t-3xl border-t border-white/5 bg-card px-6 pb-8 pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-neutral-700" />
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-lg">
                {"\u{1F389}"}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Как прошло?</h3>
                <p className="text-xs text-neutral-500">
                  Оцени опыт — это помогает подбирать лучше
                </p>
              </div>
            </div>

            {/* Rating */}
            <div className="mb-4 flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setReflectionRating(star)}
                  aria-label={`${star} звёзд`}
                  className={`flex h-11 w-11 items-center justify-center text-[28px] transition-transform active:scale-110 ${
                    star <= reflectionRating
                      ? "text-yellow-400"
                      : "text-neutral-700"
                  }`}
                  style={
                    star <= reflectionRating
                      ? {
                          filter:
                            "drop-shadow(0 0 6px rgba(250, 204, 21, 0.4))",
                        }
                      : undefined
                  }
                >
                  {star <= reflectionRating ? "★" : "☆"}
                </button>
              ))}
            </div>

            {/* Reflection text */}
            <textarea
              value={reflectionText}
              onChange={(e) => setReflectionText(e.target.value)}
              placeholder="Что заметил/узнал? (опционально)"
              rows={3}
              className="mb-4 w-full resize-none rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-accent/40"
            />

            <button
              onClick={handleComplete}
              className="w-full rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition-transform active:scale-[0.98]"
            >
              Готово {"\u{1F389}"}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function DifficultyDots({ value, color }: { value: number; color?: string }) {
  const fillColor = color || "#6366f1";
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 10 }, (_, i) => (
        <div
          key={i}
          className="h-1.5 w-1.5 rounded-full transition-colors"
          style={{
            backgroundColor:
              i < value ? fillColor : "rgba(255,255,255,0.08)",
            boxShadow:
              i < value ? `0 0 4px ${fillColor}60` : undefined,
          }}
        />
      ))}
    </div>
  );
}

const STATUS_PRIORITY: Record<string, number> = {
  completed: 4,
  accepted: 3,
  too_hard: 2,
  skipped: 1,
  pending: 0,
};

function getWeekDays(
  history: ChallengeItem[]
): { label: string; status: string; isToday: boolean }[] {
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const now = new Date();
  const monday = new Date(now);
  const dayOfWeek = now.getDay() || 7;
  monday.setDate(now.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  return days.map((label, i) => {
    const dayStart = new Date(monday.getTime() + i * 86400000);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const isToday = dayStart.getTime() === todayStart.getTime();
    const isFuture = dayStart > todayStart;

    if (isFuture && !isToday) {
      return { label, status: "future", isToday: false };
    }

    // Find the best status for this day when multiple challenges exist
    const dayChallenges = history.filter((h) => {
      const d = new Date(h.date);
      return d >= dayStart && d < dayEnd;
    });

    let bestStatus = "pending";
    for (const ch of dayChallenges) {
      if ((STATUS_PRIORITY[ch.status] ?? 0) > (STATUS_PRIORITY[bestStatus] ?? 0)) {
        bestStatus = ch.status;
      }
    }

    return {
      label,
      status: dayChallenges.length > 0 ? bestStatus : "pending",
      isToday,
    };
  });
}
