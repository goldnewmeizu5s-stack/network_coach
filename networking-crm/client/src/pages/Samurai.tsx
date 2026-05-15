import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check, Lock } from "lucide-react";
import { api } from "../lib/api";
import { timeAgo } from "../lib/warmth";
import {
  Sensei,
  SenseiResponse,
  SamuraiGrade,
  SAMURAI_GRADES,
  GrowthPlane,
  SamuraiPalette,
  gradeForPriority,
  paletteForGrade,
} from "../lib/samurai";
import SamuraiFigure from "../components/SamuraiFigure";

// ── Washi palette ─────────────────────────────────────────────
const WASHI = {
  paper: "#faf7f0",
  card: "#ffffff",
  border: "#e8e0d0",
  borderSoft: "#efe7d6",
  ink: "#1a1410",
  ink2: "#5e564c",
  ink3: "#8c8378",
  vermilion: "#9a363f",
  gold: "#b48a2a",
  jade: "#3a7a5c",
};

// ── Pareto ladder ─────────────────────────────────────────────
// Each technique has exactly 3 steps and ends. The whole point of
// Pareto is that progression is capped and the second step already
// captures 85% of the value.
interface ParetoStep {
  name: string; // Russian label, shown everywhere
  effortPct: number; // cumulative effort %
  valuePct: number; // cumulative value %
  short: string; // one-liner shown next to the step
  // Generic action template, blended with the plane's how_to_absorb.
  defaultAction: string;
}

const PARETO_STEPS: ParetoStep[] = [
  {
    name: "Наблюдай",
    effortPct: 20,
    valuePct: 60,
    short: "Заметь паттерн один раз",
    defaultAction:
      "Найди один пример этого приёма у наставника. Просто заметь и запиши, как именно он это делает.",
  },
  {
    name: "Подражай",
    effortPct: 50,
    valuePct: 85,
    short: "Примени паттерн один раз",
    defaultAction:
      "Применить приём один раз в живом разговоре. Не идеально — один раз достаточно.",
  },
  {
    name: "Усвой",
    effortPct: 100,
    valuePct: 100,
    short: "Сделай приём своим",
    defaultAction:
      "Использовать естественно, без усилия. Отрефлексируй: где работает, где нет.",
  },
];

const PARETO_ZONE_STEP = 2; // step 2 reaches 85% — the Pareto knee

// ── Page-local rank ladder ────────────────────────────────────
// IMPORTANT: a sensei's grade (from priority) tells you how strong
// THAT PERSON is in their plane. That has nothing to do with how far
// YOU are along the path. The user's grade is derived purely from
// their own progress — Pareto steps completed.
const GRADE_STEPS_MIN: Record<number, number> = {
  0: 0,
  1: 3,
  2: 10,
  3: 22,
  4: 40,
};

function userGradeFromSteps(steps: number): SamuraiGrade {
  let grade = SAMURAI_GRADES[0];
  for (const g of SAMURAI_GRADES) {
    if (steps >= GRADE_STEPS_MIN[g.index]) grade = g;
  }
  return grade;
}

function gradeStepsRange(index: number): { min: number; max: number } {
  const min = GRADE_STEPS_MIN[index] ?? 0;
  const next = GRADE_STEPS_MIN[index + 1];
  return { min, max: next != null ? next - 1 : 999 };
}

// ── Progress persistence (per-plane Pareto level 0..3) ────────
function progressKey(contactId: string, planeIndex: number): string {
  return `samurai:pareto:${contactId}:${planeIndex}`;
}
function readProgress(contactId: string, planeIndex: number): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(progressKey(contactId, planeIndex));
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0;
}
function writeProgress(contactId: string, planeIndex: number, n: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    progressKey(contactId, planeIndex),
    String(Math.max(0, Math.min(3, n))),
  );
}

// ── Stats types (from /api/stats) ─────────────────────────────
interface StatsPayload {
  total_contacts: number;
  by_status: Record<string, number>;
  avg_warmth_score: number;
  contacts_this_week: number;
  streak: number;
}

// ── User progress (the source of truth for everything on screen)
interface UserProgress {
  totalSteps: number; // sum of all Pareto levels across planes
  internalized: number; // planes at level 3
  paretoZone: number; // planes at level ≥ 2
  observed: number; // planes at level ≥ 1
  senseiCount: number;
  planeCount: number;
  totalContacts: number;
  warmContacts: number; // warming + warm
  closeContacts: number; // warm only
  warmRatio: number; // 0..1
  streak: number;
  grade: SamuraiGrade;
  nextGrade: SamuraiGrade | null;
  gradeProgressPct: number;
  stepsToNext: number;
}

// ── Achievements ──────────────────────────────────────────────
// Small, capped achievements seeded by Pareto principle. Each is a
// concrete, reachable milestone — and they're separate from rank
// (rank is a single bar, achievements are many).
interface Achievement {
  id: string;
  title: string;
  desc: string;
  emoji: string;
  unlocked: (s: UserProgress) => boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_observe",
    title: "Первая разведка",
    desc: "Замечен 1 паттерн",
    emoji: "🔭",
    unlocked: (s) => s.observed >= 1,
  },
  {
    id: "pareto_zone",
    title: "Парето-зона",
    desc: "1 техника на 85%",
    emoji: "🎯",
    unlocked: (s) => s.paretoZone >= 1,
  },
  {
    id: "first_internalize",
    title: "Первое мастерство",
    desc: "1 техника усвоена",
    emoji: "✨",
    unlocked: (s) => s.internalized >= 1,
  },
  {
    id: "five_pareto",
    title: "Пять по Парето",
    desc: "5 техник в 85%-зоне",
    emoji: "⚡",
    unlocked: (s) => s.paretoZone >= 5,
  },
  {
    id: "dojo_5",
    title: "Додзё собрано",
    desc: "5 сенсеев",
    emoji: "🏯",
    unlocked: (s) => s.senseiCount >= 5,
  },
  {
    id: "warm_seven",
    title: "Тёплая семёрка",
    desc: "7 тёплых контактов",
    emoji: "🔥",
    unlocked: (s) => s.warmContacts >= 7,
  },
  {
    id: "warm_half",
    title: "Половина сети согрета",
    desc: "50%+ контактов тёплые",
    emoji: "🌅",
    unlocked: (s) => s.warmRatio >= 0.5 && s.totalContacts >= 4,
  },
  {
    id: "ten_masters",
    title: "Десять мастеров",
    desc: "10 техник усвоено",
    emoji: "🏆",
    unlocked: (s) => s.internalized >= 10,
  },
];

const item = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: "easeOut" as const },
  },
};

function pluralMasters(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "наставник";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "наставника";
  return "наставников";
}

function pluralPlanes(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "техника";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "техники";
  return "техник";
}

// A small "tick" so the page re-derives progress when localStorage
// changes elsewhere on the same page. We bump on every step change.
function useTick(): [number, () => void] {
  const [n, setN] = useState(0);
  return [n, () => setN((v) => v + 1)];
}

export default function Samurai() {
  const navigate = useNavigate();
  const [senseis, setSenseis] = useState<Sensei[] | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, bumpTick] = useTick();

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      api.get<SenseiResponse>("/contacts/senseis", { signal: ac.signal }),
      api.get<StatsPayload>("/stats", { signal: ac.signal }).catch(() => null),
    ])
      .then(([s, st]) => {
        setSenseis(s.senseis);
        setStats(st);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(true);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  // Derive everything from senseis + localStorage + stats.
  const progress = useMemo<UserProgress | null>(() => {
    if (!senseis) return null;

    let totalSteps = 0;
    let internalized = 0;
    let paretoZone = 0;
    let observed = 0;
    let planeCount = 0;

    for (const s of senseis) {
      for (let i = 0; i < s.planes.length; i++) {
        const lvl = readProgress(s.contact_id, i);
        totalSteps += lvl;
        if (lvl >= 1) observed++;
        if (lvl >= 2) paretoZone++;
        if (lvl >= 3) internalized++;
        planeCount++;
      }
    }

    const warmContacts =
      (stats?.by_status.warming ?? 0) + (stats?.by_status.warm ?? 0);
    const closeContacts = stats?.by_status.warm ?? 0;
    const totalContacts = stats?.total_contacts ?? 0;
    const warmRatio = totalContacts > 0 ? warmContacts / totalContacts : 0;

    const grade = userGradeFromSteps(totalSteps);
    const nextGrade =
      grade.index < SAMURAI_GRADES.length - 1
        ? SAMURAI_GRADES[grade.index + 1]
        : null;
    const range = gradeStepsRange(grade.index);
    const nextMin = nextGrade ? GRADE_STEPS_MIN[nextGrade.index] : null;
    const gradeProgressPct = nextMin
      ? Math.round(
          ((totalSteps - range.min) / (nextMin - range.min)) * 100,
        )
      : 100;
    const stepsToNext = nextMin ? Math.max(0, nextMin - totalSteps) : 0;

    return {
      totalSteps,
      internalized,
      paretoZone,
      observed,
      senseiCount: senseis.length,
      planeCount,
      totalContacts,
      warmContacts,
      closeContacts,
      warmRatio,
      streak: stats?.streak ?? 0,
      grade,
      nextGrade,
      gradeProgressPct: Math.max(0, Math.min(100, gradeProgressPct)),
      stepsToNext,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senseis, stats, tick]);

  if (loading) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ backgroundColor: WASHI.paper }}
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: WASHI.vermilion, borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (error || !senseis || !progress) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        style={{ backgroundColor: WASHI.paper, color: WASHI.ink2 }}
      >
        <p className="text-sm">Не удалось загрузить путь</p>
      </div>
    );
  }

  return (
    <motion.div
      className="flex flex-1 flex-col gap-6 px-4 pt-6 pb-10"
      style={{ backgroundColor: WASHI.paper, color: WASHI.ink }}
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
    >
      {/* ── Header ── */}
      <motion.div
        className="flex items-center justify-between"
        variants={item}
      >
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl border text-xl font-bold"
          style={{
            borderColor: WASHI.border,
            backgroundColor: WASHI.card,
            color: WASHI.vermilion,
          }}
        >
          道
        </div>
        <h1
          className="text-[17px] font-bold tracking-wide"
          style={{ color: WASHI.ink }}
        >
          Путь Самурая
        </h1>
        <div className="w-10" />
      </motion.div>

      {/* ── Hero · big samurai + user's actual progress bars ── */}
      <motion.section variants={item}>
        <Hero progress={progress} />
      </motion.section>

      {/* ── Achievements ── */}
      <motion.section variants={item}>
        <SectionLabel>Ачивки по Парето</SectionLabel>
        <AchievementsRow progress={progress} />
      </motion.section>

      {senseis.length > 0 ? (
        <>
          {/* ── Mastery ladder ── */}
          <motion.section variants={item}>
            <SectionLabel>Ступени мастерства</SectionLabel>
            <MasteryLadder progress={progress} />
          </motion.section>

          {/* ── Senseis ── */}
          <motion.section variants={item}>
            <SectionLabel>
              Твоё додзё ·{" "}
              <span style={{ color: WASHI.ink3 }}>
                {senseis.length} {pluralMasters(senseis.length)}
              </span>
            </SectionLabel>
            <div className="flex flex-col gap-4">
              {senseis.map((s, i) => (
                <SenseiCard
                  key={s.contact_id}
                  sensei={s}
                  index={i}
                  onOpen={() => navigate(`/people/${s.contact_id}`)}
                  onStepChange={bumpTick}
                />
              ))}
            </div>
          </motion.section>

          {/* ── Pareto manifesto ── */}
          <motion.section variants={item}>
            <ParetoManifesto />
          </motion.section>
        </>
      ) : (
        <motion.section variants={item}>
          <EmptyDojo onGoToPeople={() => navigate("/people")} />
        </motion.section>
      )}
    </motion.div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em]"
      style={{ color: WASHI.ink3 }}
    >
      {children}
    </h3>
  );
}

// ── Hero ──────────────────────────────────────────────────────
// Three progress bars, one per question the user asked us to answer:
//   1. Главный путь — твоя ступень мастерства (от твоих действий)
//   2. Тепло сети — какая доля контактов уже тёплые
//   3. Усвоено техник — какая доля техник уже впитана
// All percentages are in Russian / decimal — no Chinese.
function Hero({ progress }: { progress: UserProgress }) {
  const grade = progress.grade;
  const pal = paletteForGrade(grade.index);

  const mainPct = progress.gradeProgressPct;
  const warmPct = Math.round(progress.warmRatio * 100);
  const masteryPct =
    progress.planeCount > 0
      ? Math.round((progress.internalized / progress.planeCount) * 100)
      : 0;

  return (
    <div
      className="relative overflow-hidden rounded-3xl"
      style={{
        backgroundColor: WASHI.card,
        border: `1px solid ${WASHI.border}`,
        boxShadow:
          "0 1px 2px rgba(26,20,17,0.04), 0 8px 24px rgba(26,20,17,0.05)",
      }}
    >
      {/* sunrise wash */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full"
        style={{
          background: `radial-gradient(closest-side, ${WASHI.vermilion}1f, transparent)`,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -bottom-16 h-44 w-44 rounded-full"
        style={{
          background: `radial-gradient(closest-side, ${WASHI.gold}1c, transparent)`,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-4 -bottom-10 select-none text-[200px] font-black leading-none"
        style={{ color: WASHI.ink, opacity: 0.025 }}
      >
        道
      </div>

      <div className="relative flex flex-col items-center px-6 pt-7 pb-6">
        <div
          className="relative"
          style={{
            filter:
              "drop-shadow(0 6px 14px rgba(26,20,17,0.10)) drop-shadow(0 2px 4px rgba(26,20,17,0.06))",
          }}
        >
          <SamuraiFigure grade={grade} size={170} />
        </div>

        <p
          className="mt-4 text-[10px] font-bold uppercase tracking-[0.28em]"
          style={{ color: WASHI.vermilion }}
        >
          Твой ранг
        </p>
        <h2
          className="mt-1 text-center text-[26px] font-bold leading-tight"
          style={{ color: WASHI.ink }}
        >
          {grade.title}
        </h2>
        <p className="mt-0.5 text-[12px]" style={{ color: WASHI.ink3 }}>
          ступень {grade.index + 1} из {SAMURAI_GRADES.length}
        </p>

        {/* Three progress bars — pure Russian, plain numbers */}
        <div className="mt-6 w-full space-y-4">
          <ProgressRow
            title="Главный путь"
            sublabel={
              progress.nextGrade
                ? `до «${progress.nextGrade.title}» осталось ${progress.stepsToNext} ${pluralShag(progress.stepsToNext)}`
                : "Высший ранг достигнут"
            }
            pct={mainPct}
            value={`${progress.totalSteps}`}
            colorFrom={pal.ring}
            colorTo={pal.emblem}
          />
          <ProgressRow
            title="Тепло сети"
            sublabel={
              progress.totalContacts > 0
                ? `${progress.warmContacts} из ${progress.totalContacts} тёплые`
                : "контактов пока нет"
            }
            pct={warmPct}
            value={`${warmPct}%`}
            colorFrom="#e89b4a"
            colorTo="#22c55e"
          />
          <ProgressRow
            title="Усвоено техник"
            sublabel={
              progress.planeCount > 0
                ? `${progress.internalized} из ${progress.planeCount} ${pluralPlanes(progress.planeCount)}`
                : "техник пока нет"
            }
            pct={masteryPct}
            value={`${masteryPct}%`}
            colorFrom={WASHI.vermilion}
            colorTo={WASHI.gold}
          />
        </div>
      </div>
    </div>
  );
}

function pluralShag(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "шаг";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "шага";
  return "шагов";
}

function ProgressRow({
  title,
  sublabel,
  pct,
  value,
  colorFrom,
  colorTo,
}: {
  title: string;
  sublabel: string;
  pct: number;
  value: string;
  colorFrom: string;
  colorTo: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-bold" style={{ color: WASHI.ink }}>
          {title}
        </p>
        <p
          className="text-[14px] font-bold tabular-nums"
          style={{ color: WASHI.ink }}
        >
          {value}
        </p>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: WASHI.borderSoft }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{
            background: `linear-gradient(90deg, ${colorFrom}, ${colorTo})`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      </div>
      <p className="mt-1 text-[10.5px]" style={{ color: WASHI.ink3 }}>
        {sublabel}
      </p>
    </div>
  );
}

// ── Achievements row ──────────────────────────────────────────
function AchievementsRow({ progress }: { progress: UserProgress }) {
  return (
    <div
      className="rounded-3xl p-3"
      style={{
        backgroundColor: WASHI.card,
        border: `1px solid ${WASHI.border}`,
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        {ACHIEVEMENTS.map((a) => {
          const got = a.unlocked(progress);
          return (
            <div
              key={a.id}
              className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5"
              style={{
                backgroundColor: got ? WASHI.paper : "transparent",
                border: `1px solid ${got ? WASHI.borderSoft : "transparent"}`,
                opacity: got ? 1 : 0.5,
              }}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[18px]"
                style={{
                  backgroundColor: got ? `${WASHI.gold}1f` : WASHI.borderSoft,
                  color: got ? WASHI.gold : WASHI.ink3,
                  filter: got ? "none" : "grayscale(0.7)",
                }}
                aria-hidden="true"
              >
                {got ? a.emoji : <Lock size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[12.5px] font-bold leading-tight"
                  style={{ color: WASHI.ink }}
                >
                  {a.title}
                </p>
                <p
                  className="mt-0.5 truncate text-[10.5px] leading-tight"
                  style={{ color: WASHI.ink3 }}
                >
                  {a.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Mastery ladder ────────────────────────────────────────────
// 5 grades stepped vertically. Each row shows the samurai figure
// for the grade, the Russian title, the "steps needed" threshold,
// and a status pill (Сейчас / Пройдено / Заперт).
function MasteryLadder({ progress }: { progress: UserProgress }) {
  return (
    <div
      className="overflow-hidden rounded-3xl"
      style={{
        backgroundColor: WASHI.card,
        border: `1px solid ${WASHI.border}`,
      }}
    >
      <ol className="flex flex-col">
        {SAMURAI_GRADES.map((g, i) => {
          const reached = g.index <= progress.grade.index;
          const isCurrent = g.index === progress.grade.index;
          const range = gradeStepsRange(g.index);
          const pal = paletteForGrade(g.index);
          const isLast = i === SAMURAI_GRADES.length - 1;
          const lit = reached;

          return (
            <li
              key={g.index}
              className="relative flex items-center gap-3 px-3.5 py-3"
              style={{
                borderBottom: isLast
                  ? "none"
                  : `1px solid ${WASHI.borderSoft}`,
                backgroundColor: isCurrent ? `${pal.ring}0d` : "transparent",
              }}
            >
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{
                  backgroundColor: lit ? pal.ring : WASHI.borderSoft,
                  color: lit ? "#fff" : WASHI.ink3,
                }}
              >
                {g.index + 1}
              </div>

              <div
                className="shrink-0"
                style={{
                  opacity: lit ? 1 : 0.4,
                  filter: lit ? "none" : "grayscale(0.85)",
                }}
              >
                <SamuraiFigure grade={g} size={48} />
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[14.5px] font-bold"
                  style={{ color: lit ? WASHI.ink : WASHI.ink3 }}
                >
                  {g.title}
                </p>
                <p
                  className="mt-0.5 text-[10.5px]"
                  style={{ color: WASHI.ink3 }}
                >
                  {range.max < 999
                    ? `${range.min}–${range.max} шагов`
                    : `${range.min}+ шагов`}{" "}
                  · усвоено {countAt(g.index, progress)} техник
                </p>
              </div>

              <div className="shrink-0">
                {isCurrent ? (
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: pal.ring, color: "#fff" }}
                  >
                    Сейчас
                  </span>
                ) : reached ? (
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: `${WASHI.jade}1f`,
                      color: WASHI.jade,
                    }}
                    aria-label="Пройдено"
                  >
                    <Check size={14} strokeWidth={2.5} />
                  </span>
                ) : (
                  <span
                    className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-medium uppercase tracking-wider"
                    style={{
                      color: WASHI.ink3,
                      opacity: 0.7,
                    }}
                  >
                    <Lock size={10} /> заперт
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Helper — masters internalised "at or before" reaching this grade.
function countAt(gradeIndex: number, progress: UserProgress): number {
  // We don't bucket techniques by grade; show total internalised across
  // all grades reached so the ladder rows mean something.
  return gradeIndex <= progress.grade.index ? progress.internalized : 0;
}

// ── Sensei card ──────────────────────────────────────────────
// Simplified: drawn samurai figure (their grade reflects strength,
// NOT user's progress), Russian-only labels, planes are minimal
// strips collapsed by default — tap to expand and act on the
// current Pareto step.
function SenseiCard({
  sensei,
  index,
  onOpen,
  onStepChange,
}: {
  sensei: Sensei;
  index: number;
  onOpen: () => void;
  onStepChange: () => void;
}) {
  const grade = gradeForPriority(sensei.priority);
  const pal = paletteForGrade(grade.index);
  const role = [sensei.occupation, sensei.company].filter(Boolean).join(" · ");
  const warmth = Math.round(sensei.warmth_score);
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{
        duration: 0.32,
        ease: "easeOut",
        delay: Math.min(index * 0.04, 0.2),
      }}
      className="relative overflow-hidden rounded-3xl"
      style={{
        backgroundColor: WASHI.card,
        border: `1px solid ${WASHI.border}`,
        boxShadow: "0 1px 2px rgba(26,20,17,0.04), 0 6px 18px rgba(26,20,17,0.05)",
      }}
    >
      {/* faint corner wash */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full"
        style={{
          background: `radial-gradient(closest-side, ${pal.ring}1e, transparent)`,
        }}
      />

      {/* Identity row */}
      <button
        type="button"
        onClick={onOpen}
        className="relative flex w-full items-center gap-3 px-4 pt-4 pb-3 text-left"
      >
        <div className="shrink-0">
          <SamuraiFigure grade={grade} size={68} />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[16px] font-bold leading-tight"
            style={{ color: WASHI.ink }}
          >
            {sensei.full_name}
          </p>
          {role && (
            <p
              className="mt-0.5 truncate text-[12px]"
              style={{ color: WASHI.ink3 }}
            >
              {role}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: `${pal.ring}1c`, color: pal.ring }}
            >
              Сила: {grade.title}
            </span>
            {sensei.planes.length > 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                style={{ color: WASHI.ink3 }}
              >
                {sensei.planes.length} {pluralPlanes(sensei.planes.length)}
              </span>
            )}
          </div>
        </div>
      </button>

      <div className="relative px-4 pb-4">
        {/* Warmth */}
        <div className="mt-1">
          <div
            className="mb-1 flex items-center justify-between text-[10.5px]"
            style={{ color: WASHI.ink3 }}
          >
            <span>Близость</span>
            <span style={{ color: WASHI.ink2 }}>{warmth}/100</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: WASHI.borderSoft }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${warmth}%`,
                background: `linear-gradient(90deg, ${pal.ring}, ${pal.emblem})`,
              }}
            />
          </div>
        </div>

        {/* Headline */}
        {sensei.headline && (
          <p
            className="mt-3.5 text-[13px] leading-snug"
            style={{ color: WASHI.ink2 }}
          >
            {sensei.headline}
          </p>
        )}

        {/* Planes */}
        {sensei.planes.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <p
                className="text-[10.5px] font-bold uppercase tracking-widest"
                style={{ color: WASHI.ink3 }}
              >
                Чему учиться
              </p>
              <div
                className="h-px flex-1"
                style={{ backgroundColor: WASHI.borderSoft }}
              />
              <span
                className="text-[9.5px] uppercase tracking-wider"
                style={{ color: WASHI.gold }}
              >
                по Парето · 3 шага
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              {sensei.planes.map((pl, i) => (
                <PlaneCard
                  key={i}
                  plane={pl}
                  index={i}
                  contactId={sensei.contact_id}
                  pal={pal}
                  onStepChange={onStepChange}
                />
              ))}
            </div>
          </div>
        )}

        {/* Strategic note (folded by default) */}
        {sensei.chess_note && (
          <div className="mt-4">
            <button
              type="button"
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((v) => !v)}
              className="flex w-full items-center gap-2 text-left"
            >
              <span
                className="text-[10.5px] font-bold uppercase tracking-widest"
                style={{ color: pal.ring }}
              >
                Заметка стратега
              </span>
              <motion.span
                animate={{ rotate: noteOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                style={{ color: pal.ring }}
                aria-hidden="true"
              >
                <ChevronDown size={14} />
              </motion.span>
              <div
                className="h-px flex-1"
                style={{ backgroundColor: WASHI.borderSoft }}
              />
            </button>
            <AnimatePresence initial={false}>
              {noteOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <p
                    className="mt-2 rounded-xl px-3 py-2 text-[12px] italic leading-relaxed"
                    style={{
                      borderLeft: `2px solid ${pal.ring}`,
                      backgroundColor: WASHI.paper,
                      color: WASHI.ink2,
                    }}
                  >
                    {sensei.chess_note}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Footer */}
        <div
          className="mt-4 flex items-center justify-between border-t pt-3 text-[10.5px]"
          style={{
            borderColor: WASHI.borderSoft,
            color: WASHI.ink3,
          }}
        >
          <span>
            {sensei.last_interaction_at
              ? `последний контакт · ${timeAgo(sensei.last_interaction_at)}`
              : "ещё не общались"}
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="font-semibold"
            style={{ color: pal.ring }}
          >
            открыть профиль →
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Plane card (the technique) ────────────────────────────────
// SIMPLE: title, plain "Шаг N из 3 — Russian step name", one
// concrete next action, a single "Сделать шаг" button. Everything
// else is folded behind a tap. No kanji.
function PlaneCard({
  plane,
  index,
  contactId,
  pal,
  onStepChange,
}: {
  plane: GrowthPlane;
  index: number;
  contactId: string;
  pal: SamuraiPalette;
  onStepChange: () => void;
}) {
  const [level, setLevel] = useState<number>(() => readProgress(contactId, index));
  const [open, setOpen] = useState(false);

  const setLvl = (n: number) => {
    setLevel(n);
    writeProgress(contactId, index, n);
    onStepChange();
  };

  const done = level >= 3;
  const currentStep = !done ? PARETO_STEPS[level] : null;

  // Use the plane's concrete how_to_absorb when we have it, especially
  // for steps 2/3 where context matters.
  const liveAction = useMemo(() => {
    if (done || !currentStep) return null;
    if (level === 0) return currentStep.defaultAction;
    return plane.how_to_absorb || currentStep.defaultAction;
  }, [done, currentStep, level, plane.how_to_absorb]);

  // Pct shown on the small bar = the value reached so far
  const reachedValue =
    level === 0 ? 0 : PARETO_STEPS[level - 1].valuePct;
  const targetValue = currentStep ? currentStep.valuePct : 100;

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        backgroundColor: done ? `${WASHI.jade}10` : WASHI.paper,
        border: `1px solid ${done ? `${WASHI.jade}55` : WASHI.borderSoft}`,
      }}
    >
      {/* Header — number, plane title, status chip */}
      <div className="flex items-center gap-3 px-3 pt-3 pb-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold leading-none"
          style={{
            backgroundColor: done ? `${WASHI.jade}1f` : `${pal.ring}1a`,
            color: done ? WASHI.jade : pal.ring,
          }}
        >
          {index + 1}
        </span>
        <p
          className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug"
          style={{ color: WASHI.ink }}
        >
          {plane.plane}
        </p>
        {done ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: `${WASHI.jade}1f`, color: WASHI.jade }}
          >
            <Check size={11} strokeWidth={3} /> освоено
          </span>
        ) : (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold leading-none"
            style={{ backgroundColor: `${pal.ring}14`, color: pal.ring }}
          >
            шаг {level + 1}/3
          </span>
        )}
      </div>

      {/* Current step body */}
      {!done && currentStep && liveAction && (
        <div className="px-3 pb-3">
          {/* Step name in plain Russian + Pareto math */}
          <div className="flex items-center justify-between">
            <p
              className="text-[12px] font-bold"
              style={{ color: pal.ring }}
            >
              Сейчас: {currentStep.name}
            </p>
            <p
              className="text-[10.5px] tabular-nums"
              style={{ color: WASHI.gold }}
            >
              {currentStep.effortPct}% усилий → {currentStep.valuePct}%
              мастерства
            </p>
          </div>

          {/* Mastery bar with Pareto knee marker at 85% */}
          <div className="mt-2">
            <div
              className="relative h-1.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: WASHI.borderSoft }}
            >
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${pal.ring}, ${pal.emblem})`,
                }}
                initial={{ width: `${reachedValue}%` }}
                animate={{ width: `${targetValue}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
              <div
                aria-hidden="true"
                className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full"
                style={{
                  left: `${PARETO_STEPS[PARETO_ZONE_STEP - 1].valuePct}%`,
                  backgroundColor: WASHI.gold,
                  opacity: 0.7,
                }}
              />
            </div>
            <div
              className="mt-1 flex items-center justify-between text-[9.5px]"
              style={{ color: WASHI.ink3 }}
            >
              <span>от 0%</span>
              <span style={{ color: WASHI.gold }}>
                ↑ Парето-зона (после шага 2)
              </span>
              <span>100%</span>
            </div>
          </div>

          {/* The next concrete move */}
          <p
            className="mt-3 rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed"
            style={{
              backgroundColor: WASHI.card,
              border: `1px solid ${WASHI.borderSoft}`,
              color: WASHI.ink,
            }}
          >
            → {liveAction}
          </p>

          {/* Action row */}
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLvl(level + 1)}
              className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
              style={{ backgroundColor: pal.ring, color: "#fff" }}
            >
              {level === 0
                ? "Я заметил →"
                : level === 1
                  ? "Я применил →"
                  : "Я усвоил ✓"}
            </button>
            {level > 0 && (
              <button
                type="button"
                onClick={() => setLvl(level - 1)}
                className="rounded-full px-2.5 py-1.5 text-[11px]"
                style={{ color: WASHI.ink3 }}
              >
                назад
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1 text-[10.5px] font-medium"
              style={{ color: WASHI.ink3 }}
            >
              <span>{open ? "свернуть" : "подробнее"}</span>
              <motion.span
                animate={{ rotate: open ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                aria-hidden="true"
              >
                <ChevronDown size={12} />
              </motion.span>
            </button>
          </div>
        </div>
      )}

      {/* Done state */}
      {done && (
        <div className="flex items-center gap-2 px-3 pb-3 pt-1">
          <p
            className="flex-1 text-[12px] leading-relaxed"
            style={{ color: WASHI.ink2 }}
          >
            Приём твой. Дальше — только полировка, если нужно.
          </p>
          <button
            type="button"
            onClick={() => setLvl(0)}
            className="rounded-full px-2.5 py-1 text-[10.5px]"
            style={{ color: WASHI.ink3 }}
          >
            сбросить
          </button>
        </div>
      )}

      {/* Expanded details */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div
              className="mx-3 mb-3 rounded-xl px-3 py-3"
              style={{
                backgroundColor: WASHI.card,
                border: `1px solid ${WASHI.borderSoft}`,
              }}
            >
              {plane.why && (
                <p
                  className="text-[11.5px] leading-relaxed"
                  style={{ color: WASHI.ink2 }}
                >
                  <span
                    className="font-bold uppercase tracking-widest"
                    style={{ color: WASHI.ink3, fontSize: 9 }}
                  >
                    почему ·{" "}
                  </span>
                  {plane.why}
                </p>
              )}
              <div className="mt-3 flex flex-col gap-1.5">
                {PARETO_STEPS.map((s, i) => {
                  const isDone = i < level;
                  const isNow = i === level && !done;
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2.5 rounded-lg px-2.5 py-2"
                      style={{
                        backgroundColor: isNow
                          ? `${pal.ring}0d`
                          : isDone
                            ? `${WASHI.jade}0a`
                            : "transparent",
                      }}
                    >
                      <span
                        className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none"
                        style={{
                          backgroundColor: isDone
                            ? WASHI.jade
                            : isNow
                              ? pal.ring
                              : WASHI.borderSoft,
                          color: isDone || isNow ? "#fff" : WASHI.ink3,
                        }}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-[11.5px] font-bold"
                          style={{ color: WASHI.ink }}
                        >
                          {s.name}{" "}
                          <span
                            className="font-medium"
                            style={{ color: WASHI.ink3 }}
                          >
                            · {s.effortPct}% усилий → {s.valuePct}%
                            мастерства
                          </span>
                        </p>
                        <p
                          className="mt-0.5 text-[11px] leading-relaxed"
                          style={{ color: WASHI.ink2 }}
                        >
                          {s.short}.{" "}
                          {i === 0 ||
                          !plane.how_to_absorb ||
                          isDone ||
                          !isNow
                            ? s.defaultAction
                            : plane.how_to_absorb}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Pareto manifesto ──────────────────────────────────────────
function ParetoManifesto() {
  return (
    <div
      className="relative overflow-hidden rounded-3xl px-5 py-5"
      style={{
        backgroundColor: WASHI.card,
        border: `1px solid ${WASHI.border}`,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 -top-4 select-none text-[100px] font-black leading-none"
        style={{ color: WASHI.gold, opacity: 0.07 }}
      >
        80
      </div>
      <p
        className="text-[10px] font-bold uppercase tracking-[0.28em]"
        style={{ color: WASHI.gold }}
      >
        Принцип Парето
      </p>
      <p
        className="mt-2 text-[14px] font-semibold leading-snug"
        style={{ color: WASHI.ink }}
      >
        20% действий — 80% результата.
      </p>
      <p
        className="mt-2 text-[12px] leading-relaxed"
        style={{ color: WASHI.ink2 }}
      >
        Каждая техника заканчивается за 3 шага. После шага 2 ты уже
        получаешь 85% мастерства — это Парето-зона, и обычно дальше идти
        не нужно. Третий шаг — полировка для критичных приёмов.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {PARETO_STEPS.map((s, i) => (
          <div
            key={i}
            className="rounded-2xl px-2.5 py-2 text-center"
            style={{
              backgroundColor: WASHI.paper,
              border: `1px solid ${WASHI.borderSoft}`,
            }}
          >
            <p
              className="text-[11px] font-bold leading-none"
              style={{ color: WASHI.vermilion }}
            >
              Шаг {i + 1}
            </p>
            <p
              className="mt-1.5 text-[12px] font-bold leading-none"
              style={{ color: WASHI.ink }}
            >
              {s.name}
            </p>
            <p
              className="mt-1 text-[9.5px] leading-tight tabular-nums"
              style={{ color: WASHI.ink3 }}
            >
              {s.effortPct}% → {s.valuePct}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Empty dojo ────────────────────────────────────────────────
function EmptyDojo({ onGoToPeople }: { onGoToPeople: () => void }) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl px-6 py-10 text-center"
      style={{
        backgroundColor: WASHI.card,
        border: `1px solid ${WASHI.border}`,
        boxShadow: "0 1px 2px rgba(26,20,17,0.04)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full"
        style={{
          background: `radial-gradient(closest-side, ${WASHI.vermilion}1a, transparent)`,
        }}
      />
      <div className="relative mx-auto mb-3">
        <SamuraiFigure grade={SAMURAI_GRADES[0]} size={100} />
      </div>
      <h2 className="text-[16px] font-bold" style={{ color: WASHI.ink }}>
        На твоём пути ещё нет сенсеев
      </h2>
      <p
        className="mx-auto mt-2 max-w-[300px] text-[12.5px] leading-relaxed"
        style={{ color: WASHI.ink2 }}
      >
        Сенсей появляется, когда агент находит человека, который сильнее
        тебя в конкретной плоскости. Открой контакт и запусти «Зону
        роста».
      </p>
      <button
        onClick={onGoToPeople}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold"
        style={{ backgroundColor: WASHI.vermilion, color: "#fff" }}
      >
        К контактам
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
