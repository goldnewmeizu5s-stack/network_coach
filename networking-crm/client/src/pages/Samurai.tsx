import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";
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
  gradeRange,
} from "../lib/samurai";
import SamuraiCrest from "../components/SamuraiCrest";

// ── Washi palette ─────────────────────────────────────────────
// The page is a sheet of warm washi paper. Sumi ink for text,
// vermilion (朱) for the house accent, gold (金) for mastery.
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

// Pareto ladder for a single plane (skill to absorb). Three steps,
// each capped — the whole point is that mastery is finite. The first
// step is the Pareto sweet-spot (20% effort → 60% of the value);
// step 2 hits 85%; step 3 only adds polish.
interface ParetoStep {
  kanji: string;
  name: string; // RU label
  effort: number; // cumulative effort %
  value: number; // cumulative value %
  // Generic action template, blended with the plane's how_to_absorb.
  action: string;
}

const PARETO_STEPS: ParetoStep[] = [
  {
    kanji: "観",
    name: "Наблюдай",
    effort: 20,
    value: 60,
    action: "Найди один пример паттерна у наставника. Заметь и запиши.",
  },
  {
    kanji: "真",
    name: "Подражай",
    effort: 50,
    value: 85,
    action: "Примени паттерн один раз в живом разговоре. Достаточно одного.",
  },
  {
    kanji: "得",
    name: "Усвой",
    effort: 100,
    value: 100,
    action: "Сделай паттерн своим. Где работает, где нет — отрефлексируй.",
  },
];

const PARETO_SWEET_SPOT = 2; // after step 2 you have 85% — stop unless it matters

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

// Kanji ordinals dress the patterns list — first, second, third…
const KANJI_ORDINALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
function ordinal(i: number): string {
  return KANJI_ORDINALS[i] ?? String(i + 1);
}

// ── Pareto progress store ─────────────────────────────────────
// Per-plane progression (0..3) is private to this client; the server
// doesn't (yet) persist it. localStorage is more than enough — losing
// it just resets the ladder, no real data is destroyed.
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

export default function Samurai() {
  const navigate = useNavigate();
  const [senseis, setSenseis] = useState<Sensei[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    api
      .get<SenseiResponse>("/contacts/senseis", { signal: ac.signal })
      .then((d) => setSenseis(d.senseis))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(true);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

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

  if (error || !senseis) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        style={{ backgroundColor: WASHI.paper, color: WASHI.ink2 }}
      >
        <p className="text-sm">Не удалось загрузить путь</p>
      </div>
    );
  }

  const planeCount = senseis.reduce((s, x) => s + x.planes.length, 0);
  const topGrade: SamuraiGrade | null =
    senseis.length > 0
      ? senseis
          .map((s) => gradeForPriority(s.priority))
          .reduce((a, b) => (b.index > a.index ? b : a))
      : null;
  const gradesHeld = new Set(
    senseis.map((s) => gradeForPriority(s.priority).index),
  );

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

      {senseis.length > 0 ? (
        <>
          {/* ── Hero ── */}
          <motion.section variants={item}>
            <DojoHero
              count={senseis.length}
              planeCount={planeCount}
              topGrade={topGrade}
            />
          </motion.section>

          {/* ── Mastery ladder ── */}
          <motion.section variants={item}>
            <SectionLabel>Лестница мастерства</SectionLabel>
            <MasteryLadder gradesHeld={gradesHeld} topGrade={topGrade} />
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

// ── Section label — small kanji-flavoured caption ─────────────
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

// ── Dojo hero ─────────────────────────────────────────────────
// White washi card. Big crest at centre, grade title, count chips,
// progress bar to the next grade. Mirrors the Rank page hero feel.
function DojoHero({
  count,
  planeCount,
  topGrade,
}: {
  count: number;
  planeCount: number;
  topGrade: SamuraiGrade | null;
}) {
  const grade = topGrade ?? SAMURAI_GRADES[0];
  const pal = paletteForGrade(grade.index);

  // Progress towards next grade — capped at the top grade.
  const nextGrade =
    grade.index < SAMURAI_GRADES.length - 1
      ? SAMURAI_GRADES[grade.index + 1]
      : null;
  const progressPct = nextGrade
    ? Math.min(
        100,
        Math.round(((grade.index + 1) / SAMURAI_GRADES.length) * 100),
      )
    : 100;

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
      {/* Subtle sunrise wash in the corner — vermilion bleed */}
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
      {/* Kanji watermark */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-4 -bottom-10 select-none text-[200px] font-black leading-none"
        style={{ color: WASHI.ink, opacity: 0.025 }}
      >
        道
      </div>

      <div className="relative flex flex-col items-center px-6 pt-8 pb-7">
        {/* Big crest */}
        <div
          className="relative"
          style={{
            filter:
              "drop-shadow(0 6px 14px rgba(26,20,17,0.10)) drop-shadow(0 2px 4px rgba(26,20,17,0.06))",
          }}
        >
          <SamuraiCrest grade={grade} size={170} shine />
        </div>

        <p
          className="mt-4 text-[10px] font-bold uppercase tracking-[0.28em]"
          style={{ color: WASHI.vermilion }}
        >
          Высший грейд
        </p>
        <h2
          className="mt-1 text-center text-[26px] font-bold leading-tight"
          style={{ color: WASHI.ink }}
        >
          {grade.kanji} {grade.title}
        </h2>
        <p className="mt-0.5 text-[12px]" style={{ color: WASHI.ink3 }}>
          {grade.romaji}
        </p>

        {/* Stats row */}
        <div className="mt-5 grid w-full grid-cols-3 gap-2">
          <HeroChip kanji="師" value={String(count)} label="сенсеев" />
          <HeroChip kanji="技" value={String(planeCount)} label="техник" />
          <HeroChip
            kanji="級"
            value={`${grade.index + 1}/${SAMURAI_GRADES.length}`}
            label="ступень"
          />
        </div>

        {/* Progress to next grade */}
        <div className="mt-6 w-full">
          <div
            className="h-2 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: WASHI.borderSoft }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{
                background: `linear-gradient(90deg, ${pal.ring}, ${pal.emblem})`,
              }}
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
          <div
            className="mt-2 flex items-center justify-between text-[11px]"
            style={{ color: WASHI.ink3 }}
          >
            <span>
              {grade.kanji} {grade.title}
            </span>
            <span>
              {nextGrade
                ? `→ ${nextGrade.kanji} ${nextGrade.title}`
                : "Высший достигнут"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroChip({
  kanji,
  value,
  label,
}: {
  kanji: string;
  value: string;
  label: string;
}) {
  return (
    <div
      className="rounded-2xl px-3 py-2.5 text-center"
      style={{
        backgroundColor: WASHI.paper,
        border: `1px solid ${WASHI.borderSoft}`,
      }}
    >
      <p
        className="text-[15px] leading-none"
        style={{ color: WASHI.vermilion, opacity: 0.75 }}
      >
        {kanji}
      </p>
      <p
        className="mt-1.5 text-[17px] font-bold leading-none"
        style={{ color: WASHI.ink }}
      >
        {value}
      </p>
      <p
        className="mt-1 text-[10px] leading-none"
        style={{ color: WASHI.ink3 }}
      >
        {label}
      </p>
    </div>
  );
}

// ── Mastery ladder ────────────────────────────────────────────
// Vertical step-by-step ladder of all 5 grades. Reached grades are
// lit; the rest are quiet greyscale. A thin path connects the steps.
function MasteryLadder({
  gradesHeld,
  topGrade,
}: {
  gradesHeld: Set<number>;
  topGrade: SamuraiGrade | null;
}) {
  const maxHeld = topGrade ? topGrade.index : -1;

  return (
    <div
      className="overflow-hidden rounded-3xl"
      style={{
        backgroundColor: WASHI.card,
        border: `1px solid ${WASHI.border}`,
        boxShadow: "0 1px 2px rgba(26,20,17,0.04)",
      }}
    >
      <ol className="flex flex-col">
        {SAMURAI_GRADES.map((g, i) => {
          const held = gradesHeld.has(g.index);
          const reached = g.index <= maxHeld;
          const lit = held || reached;
          const isCurrent = topGrade?.index === g.index;
          const range = gradeRange(g.index);
          const pal = paletteForGrade(g.index);
          const isLast = i === SAMURAI_GRADES.length - 1;

          return (
            <li
              key={g.index}
              className="relative flex items-center gap-3 px-4 py-3.5"
              style={{
                borderBottom: isLast
                  ? "none"
                  : `1px solid ${WASHI.borderSoft}`,
                backgroundColor: isCurrent
                  ? `${pal.ring}0d` // very soft tint for the active row
                  : "transparent",
              }}
            >
              {/* Step number (灯 — lit) */}
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{
                  backgroundColor: lit ? pal.ring : WASHI.borderSoft,
                  color: lit ? "#fff" : WASHI.ink3,
                }}
              >
                {g.index + 1}
              </div>

              {/* Crest (greyscale if not reached) */}
              <div
                className="shrink-0"
                style={{ opacity: lit ? 1 : 0.35, filter: lit ? "none" : "grayscale(0.9)" }}
              >
                <SamuraiCrest grade={g} size={44} />
              </div>

              {/* Title + meta */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p
                    className="truncate text-[14px] font-bold"
                    style={{ color: lit ? WASHI.ink : WASHI.ink3 }}
                  >
                    {g.kanji} {g.title}
                  </p>
                  <p
                    className="shrink-0 text-[10.5px]"
                    style={{ color: WASHI.ink3 }}
                  >
                    {g.romaji}
                  </p>
                </div>
                <p
                  className="mt-0.5 text-[11px]"
                  style={{ color: WASHI.ink3 }}
                >
                  приоритет {range.min}
                  {range.max < 100 ? `–${range.max}` : "+"} ·{" "}
                  {g.petals} лепестков
                </p>
              </div>

              {/* Status chip */}
              <div className="shrink-0">
                {isCurrent ? (
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      backgroundColor: pal.ring,
                      color: "#fff",
                    }}
                  >
                    Сейчас
                  </span>
                ) : reached ? (
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${WASHI.jade}1f`, color: WASHI.jade }}
                    aria-label="Достигнут"
                  >
                    <Check size={14} strokeWidth={2.5} />
                  </span>
                ) : (
                  <span
                    className="text-[10px] font-medium uppercase tracking-wider"
                    style={{ color: WASHI.ink3, opacity: 0.6 }}
                  >
                    Заперт
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

// ── Sensei card (white) ──────────────────────────────────────
// One sensei = one beautiful white card. Crest + identity at top,
// узы (warmth), headline, then the heart: planes as Pareto progress
// strips, each with its current step / next action.
function SenseiCard({
  sensei,
  index,
  onOpen,
}: {
  sensei: Sensei;
  index: number;
  onOpen: () => void;
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
        borderLeft: `4px solid ${pal.ring}`,
        boxShadow:
          "0 1px 2px rgba(26,20,17,0.04), 0 6px 18px rgba(26,20,17,0.05)",
      }}
    >
      {/* faint grade-tinted corner wash */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full"
        style={{
          background: `radial-gradient(closest-side, ${pal.ring}22, transparent)`,
        }}
      />

      {/* ── Identity row (tap → profile) ── */}
      <button
        type="button"
        onClick={onOpen}
        className="relative flex w-full items-start gap-3 px-4 pt-4 pb-3 text-left"
      >
        <div
          className="shrink-0 rounded-2xl"
          style={{
            backgroundColor: WASHI.paper,
            padding: 4,
            border: `1px solid ${WASHI.borderSoft}`,
          }}
        >
          <SamuraiCrest grade={grade} size={56} />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[16px] font-bold"
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
              style={{
                backgroundColor: `${pal.ring}1f`,
                color: pal.ring,
              }}
            >
              {grade.kanji} {grade.title}
            </span>
            <span
              className="text-[10px]"
              style={{ color: WASHI.ink3 }}
            >
              приоритет {sensei.priority}/100
            </span>
          </div>
        </div>
      </button>

      <div className="relative px-4 pb-4">
        {/* ── Узы (warmth) — light-themed bar ── */}
        <div className="mt-1">
          <div
            className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest"
            style={{ color: WASHI.ink3 }}
          >
            <span>Узы</span>
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

        {/* ── Headline ── */}
        {sensei.headline && (
          <p
            className="mt-3.5 text-[13px] leading-snug"
            style={{ color: WASHI.ink2 }}
          >
            {sensei.headline}
          </p>
        )}

        {/* ── Patterns (Pareto progression) ── */}
        {sensei.planes.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <p
                className="text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: WASHI.ink3 }}
              >
                Чему учиться рядом
              </p>
              <span
                className="rounded-full px-1.5 py-px text-[10px] font-bold leading-none"
                style={{
                  backgroundColor: `${pal.ring}1f`,
                  color: pal.ring,
                }}
              >
                {sensei.planes.length}
              </span>
              <div
                className="h-px flex-1"
                style={{ backgroundColor: WASHI.borderSoft }}
              />
              <span
                className="text-[9px] uppercase tracking-wider"
                style={{ color: WASHI.gold }}
              >
                по Парето
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              {sensei.planes.map((pl, i) => (
                <ParetoPlaneCard
                  key={i}
                  plane={pl}
                  index={i}
                  contactId={sensei.contact_id}
                  pal={pal}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Strategic note ── */}
        {sensei.chess_note && (
          <div className="mt-4">
            <button
              type="button"
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((v) => !v)}
              className="flex w-full items-center gap-2 text-left"
            >
              <span
                className="text-[10px] font-bold uppercase tracking-widest"
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
                      backgroundColor: `${pal.field}0a`,
                      color: WASHI.ink2,
                    }}
                  >
                    「{sensei.chess_note}」
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Footer ── */}
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
            открыть →
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Pareto progress strip for a single plane ─────────────────
// One technique = one capped 3-step ladder. The card shows the
// current step, the next concrete action, and the 20/80 hint.
// Tapping a dot sets that level. The whole point: it ends.
function ParetoPlaneCard({
  plane,
  index,
  contactId,
  pal,
}: {
  plane: GrowthPlane;
  index: number;
  contactId: string;
  pal: SamuraiPalette;
}) {
  // Persisted progress 0..3 (3 = "впитано")
  const [level, setLevel] = useState<number>(() => readProgress(contactId, index));
  const [open, setOpen] = useState(false);

  const setLvl = (n: number) => {
    setLevel(n);
    writeProgress(contactId, index, n);
  };

  const done = level >= 3;
  const currentStep = !done ? PARETO_STEPS[level] : null;
  const prevValue = level > 0 ? PARETO_STEPS[level - 1].value : 0;
  const nextValue = currentStep ? currentStep.value : 100;

  // Custom action — blend server's how_to_absorb into the current step.
  const liveAction = useMemo(() => {
    if (done || !currentStep) return null;
    if (level === 0) return currentStep.action; // observation is universal
    // For step 2/3 prefer the plane's actual how_to_absorb when present
    return plane.how_to_absorb || currentStep.action;
  }, [done, currentStep, level, plane.how_to_absorb]);

  return (
    <div
      className="overflow-hidden rounded-2xl transition-colors"
      style={{
        backgroundColor: done ? `${WASHI.jade}0d` : WASHI.paper,
        border: `1px solid ${done ? `${WASHI.jade}55` : WASHI.borderSoft}`,
      }}
    >
      {/* Head row — ordinal · title · level chip */}
      <div className="flex items-center gap-3 px-3 pt-3">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold leading-none"
          style={{
            backgroundColor: done ? `${WASHI.jade}1f` : `${pal.ring}1a`,
            color: done ? WASHI.jade : pal.ring,
          }}
        >
          {ordinal(index)}
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
            <Check size={11} strokeWidth={3} /> впитано
          </span>
        ) : (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold leading-none"
            style={{ backgroundColor: `${pal.ring}14`, color: pal.ring }}
          >
            {level}/3
          </span>
        )}
      </div>

      {/* Pareto progress dots — tappable */}
      <div className="px-3 pt-2.5">
        <div className="flex items-center gap-1.5">
          {PARETO_STEPS.map((s, i) => {
            const filled = i < level || done;
            const isCurrent = i === level && !done;
            return (
              <button
                key={i}
                type="button"
                aria-label={`${s.kanji} ${s.name}: ${s.effort}% усилий → ${s.value}% мастерства`}
                onClick={() => setLvl(i + 1 === level ? i : i + 1)}
                className="group flex items-center gap-1.5"
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all"
                  style={{
                    backgroundColor: filled
                      ? done
                        ? WASHI.jade
                        : pal.ring
                      : isCurrent
                        ? "#fff"
                        : WASHI.borderSoft,
                    color: filled
                      ? "#fff"
                      : isCurrent
                        ? pal.ring
                        : WASHI.ink3,
                    border: isCurrent
                      ? `1.5px dashed ${pal.ring}`
                      : `1px solid ${filled ? "transparent" : WASHI.border}`,
                  }}
                >
                  {s.kanji}
                </span>
                {i < PARETO_STEPS.length - 1 && (
                  <span
                    className="h-px w-3"
                    aria-hidden="true"
                    style={{
                      backgroundColor: i < level - 1 || done
                        ? pal.ring
                        : WASHI.border,
                    }}
                  />
                )}
              </button>
            );
          })}
          <div className="flex-1" />
          {!done && currentStep && (
            <span
              className="text-[10px] font-medium tabular-nums"
              style={{ color: WASHI.gold }}
            >
              {currentStep.effort}% → {currentStep.value}%
            </span>
          )}
        </div>

        {/* The big 20/80 progress arc — visual proof of Pareto */}
        {!done && (
          <div className="mt-2.5">
            <div
              className="relative h-1.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: WASHI.borderSoft }}
            >
              {/* "value so far" filled bar */}
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${pal.ring}, ${pal.emblem})`,
                }}
                initial={{ width: `${prevValue}%` }}
                animate={{ width: `${nextValue}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
              {/* Sweet-spot marker at 85% (the Pareto knee) */}
              <div
                aria-hidden="true"
                className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full"
                style={{
                  left: `${PARETO_STEPS[PARETO_SWEET_SPOT - 1].value}%`,
                  backgroundColor: WASHI.gold,
                  opacity: 0.6,
                }}
              />
            </div>
            <div
              className="mt-1 flex items-center justify-between text-[9.5px]"
              style={{ color: WASHI.ink3 }}
            >
              <span>0%</span>
              <span style={{ color: WASHI.gold }}>
                ↑ Парето-зона (после шага 2)
              </span>
              <span>100%</span>
            </div>
          </div>
        )}
      </div>

      {/* Current step body — the actual move */}
      {!done && currentStep && liveAction && (
        <div className="px-3 pt-2.5 pb-3">
          <p
            className="text-[10.5px] font-bold uppercase tracking-widest"
            style={{ color: pal.ring }}
          >
            Сейчас · {currentStep.kanji} {currentStep.name}
          </p>
          <p
            className="mt-1 rounded-xl px-3 py-2 text-[12px] leading-relaxed"
            style={{
              backgroundColor: WASHI.card,
              border: `1px solid ${WASHI.borderSoft}`,
              color: WASHI.ink,
            }}
          >
            → {liveAction}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLvl(level + 1)}
              className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors"
              style={{
                backgroundColor: pal.ring,
                color: "#fff",
              }}
            >
              {level === 2 ? "Закрепить ✓" : "Сделано →"}
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
              <span>детали</span>
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

      {/* Done state — small celebration */}
      {done && (
        <div className="flex items-center gap-2 px-3 pb-3 pt-1">
          <p
            className="flex-1 text-[12px] leading-relaxed"
            style={{ color: WASHI.ink2 }}
          >
            Паттерн твой. Дальше — только полировка, если захочется.
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

      {/* Expandable details — why + 3-step breakdown */}
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
              className="mx-3 mb-3 mt-1 rounded-xl px-3 py-3"
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
              <div className="mt-3 flex flex-col gap-2">
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
                        {s.kanji}
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
                            · {s.effort}% усилий → {s.value}% мастерства
                          </span>
                        </p>
                        <p
                          className="mt-0.5 text-[11px] leading-relaxed"
                          style={{ color: WASHI.ink2 }}
                        >
                          {s.action}
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

// ── Pareto manifesto card ────────────────────────────────────
// Short reminder of the rule that governs the whole page.
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
        className="pointer-events-none absolute -right-4 -top-6 select-none text-[110px] font-black leading-none"
        style={{ color: WASHI.gold, opacity: 0.08 }}
      >
        八
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
        Прокачка каждой техники ограничена тремя шагами и завершается. После
        шага 2 у тебя уже 85% мастерства — это и есть Парето-зона. Третий шаг —
        полировка, иди в неё только если паттерн правда критичен.
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
              className="text-[16px] font-bold leading-none"
              style={{ color: WASHI.vermilion }}
            >
              {s.kanji}
            </p>
            <p
              className="mt-1 text-[11px] font-bold leading-none"
              style={{ color: WASHI.ink }}
            >
              {s.name}
            </p>
            <p
              className="mt-1 text-[9.5px] leading-tight tabular-nums"
              style={{ color: WASHI.ink3 }}
            >
              {s.effort}% → {s.value}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Empty dojo (white-themed) ────────────────────────────────
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
      <div className="relative mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl text-[34px]"
        style={{
          backgroundColor: WASHI.paper,
          color: WASHI.vermilion,
          border: `1px solid ${WASHI.border}`,
        }}
      >
        侍
      </div>
      <h2
        className="text-[16px] font-bold"
        style={{ color: WASHI.ink }}
      >
        На твоём пути ещё нет сенсеев
      </h2>
      <p
        className="mx-auto mt-2 max-w-[300px] text-[12.5px] leading-relaxed"
        style={{ color: WASHI.ink2 }}
      >
        Сенсей появляется, когда агент находит человека, который сильнее тебя в
        конкретной плоскости. Открой контакт и запусти «Зону роста» — или
        обнови все контакты сразу со страницы People.
      </p>
      <button
        onClick={onGoToPeople}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold"
        style={{
          backgroundColor: WASHI.vermilion,
          color: "#fff",
        }}
      >
        К контактам
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
