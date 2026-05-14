import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
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
  gradeRange,
  paletteForGrade,
} from "../lib/samurai";
import SamuraiCrest from "../components/SamuraiCrest";

const item = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};

function pluralMasters(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "наставник";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "наставника";
  return "наставников";
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
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#9a363f] border-t-transparent" />
      </div>
    );
  }

  if (error || !senseis) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-neutral-400">Не удалось загрузить путь</p>
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
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
    >
      {/* ── Header ── */}
      <motion.div className="flex items-center gap-3" variants={item}>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#9a363f]/30 bg-gradient-to-br from-[#5a1f25] to-[#15140f] text-2xl font-bold text-[#f0c450]">
          道
        </div>
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-white">Самураи пути</h1>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            {senseis.length > 0
              ? `Твоё додзё · ${senseis.length} ${pluralMasters(senseis.length)}`
              : "Твоё додзё ещё пустует"}
          </p>
        </div>
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

          {/* ── Senseis ── */}
          <motion.section variants={item}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Твои наставники
            </h3>
            <div className="flex flex-col gap-3">
              {senseis.map((s) => (
                <SamuraiCard
                  key={s.contact_id}
                  sensei={s}
                  onOpen={() => navigate(`/people/${s.contact_id}`)}
                />
              ))}
            </div>
          </motion.section>
        </>
      ) : (
        <motion.section variants={item}>
          <EmptyDojo onGoToPeople={() => navigate("/people")} />
        </motion.section>
      )}

      {/* ── Grade ladder ── */}
      <motion.section variants={item}>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Путь мастерства
        </h3>
        <div className="flex flex-col gap-2">
          {SAMURAI_GRADES.map((g) => {
            const held = gradesHeld.has(g.index);
            const pal = paletteForGrade(g.index);
            const range = gradeRange(g.index);
            return (
              <div
                key={g.index}
                className="flex items-center gap-3 rounded-xl border p-2.5"
                style={{
                  borderColor: held
                    ? pal.ring + "66"
                    : "rgba(255,255,255,0.05)",
                  background: held
                    ? pal.field + "26"
                    : "rgba(255,255,255,0.02)",
                  opacity: held ? 1 : 0.55,
                }}
              >
                <div className={held ? "" : "grayscale"}>
                  <SamuraiCrest grade={g} size={48} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    <span style={{ color: pal.emblem }}>{g.kanji}</span>{" "}
                    {g.title}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {g.romaji} · приоритет {range.min}–{range.max}
                  </p>
                </div>
                {held && (
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: pal.ring + "33", color: pal.emblem }}
                  >
                    в строю
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-600">
          Грейд наставника растёт с «приоритетом» из Зоны роста — насколько
          агрессивно стоит у него учиться. Сенсеи появляются, когда агент
          находит человека, который сильнее тебя в конкретной плоскости.
        </p>
      </motion.section>
    </motion.div>
  );
}

// ── Rising-sun backdrop ───────────────────────────────────────
// A 旭日 sunburst clipped by the card it sits in. Purely decorative.
function RisingSun() {
  const cx = 300;
  const cy = 38;
  const R = 440;
  const n = 24;
  const rays = Array.from({ length: n }, (_, i) => {
    const a0 = (2 * Math.PI * i) / n;
    const a1 = a0 + Math.PI / n;
    const x0 = cx + R * Math.cos(a0);
    const y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1);
    const y1 = cy + R * Math.sin(a1);
    return `M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
  });
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 360 240"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g opacity={0.1}>
        {rays.map((d, i) => (
          <path key={i} d={d} fill={i % 2 === 0 ? "#c8313b" : "#f0c450"} />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={26} fill="#c8313b" opacity={0.2} />
    </svg>
  );
}

// ── Dojo hero ─────────────────────────────────────────────────
function DojoHero({
  count,
  planeCount,
  topGrade,
}: {
  count: number;
  planeCount: number;
  topGrade: SamuraiGrade | null;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-[#9a363f]/25 bg-gradient-to-br from-[#2a1416] via-[#1a1012] to-[#0f0f0f] p-6">
      <RisingSun />
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#9a363f]/20 blur-3xl" />
      <div className="pointer-events-none absolute -left-16 bottom-0 h-44 w-44 rounded-full bg-[#f0c450]/10 blur-3xl" />

      <div className="relative">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#f0c450]/80">
          путь воина
        </p>
        <p className="mt-2 text-[15px] font-medium leading-relaxed text-neutral-100">
          «Стать сильнее можно только в схватке с сильнейшим — но сильнее он
          лишь в своей плоскости.»
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-500">
          Это твоё додзё: люди, у которых есть чему научиться, и техники,
          которые стоит у них перенять.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <HeroStat kanji="師" value={String(count)} label="сенсеев" />
          <HeroStat kanji="技" value={String(planeCount)} label="техник" />
          <HeroStat
            kanji={topGrade?.kanji ?? "—"}
            value={topGrade?.title ?? "—"}
            label="высший грейд"
            small
          />
        </div>
      </div>
    </div>
  );
}

function HeroStat({
  kanji,
  value,
  label,
  small,
}: {
  kanji: string;
  value: string;
  label: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-center">
      <p className="text-lg leading-none text-[#f0c450]/70">{kanji}</p>
      <p
        className={`mt-1.5 font-bold text-white ${
          small ? "text-[13px] leading-tight" : "text-xl"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-neutral-500">{label}</p>
    </div>
  );
}

// ── Sensei card ───────────────────────────────────────────────
// Kanji ordinals dress the patterns list — first, second, third…
const KANJI_ORDINALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
function ordinal(i: number): string {
  return KANJI_ORDINALS[i] ?? String(i + 1);
}

// One "plane" — a pattern worth absorbing. The title stays visible so the
// card is scannable; the reasoning + how-to are tucked behind a tap.
function PlaneRow({
  plane,
  index,
  pal,
}: {
  plane: GrowthPlane;
  index: number;
  pal: SamuraiPalette;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(plane.why || plane.how_to_absorb);

  return (
    <div
      className="overflow-hidden rounded-xl border transition-colors"
      style={{
        borderColor: open ? pal.ring + "55" : "rgba(255,255,255,0.06)",
        backgroundColor: open ? pal.field + "1f" : "rgba(255,255,255,0.025)",
      }}
    >
      <button
        type="button"
        aria-expanded={hasDetail ? open : undefined}
        onClick={(e) => {
          if (!hasDetail) return; // let the tap bubble to the card → profile
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold leading-none"
          style={{ backgroundColor: pal.ring + "2e", color: pal.emblem }}
        >
          {ordinal(index)}
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-neutral-100">
          {plane.plane}
        </span>
        {hasDetail && (
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0"
            style={{ color: pal.emblem }}
            aria-hidden="true"
          >
            <ChevronDown size={16} />
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 pb-3 pl-[52px] pr-3">
              {plane.why && (
                <p className="text-[11.5px] leading-relaxed text-neutral-400">
                  <span className="font-medium text-neutral-500">почему: </span>
                  {plane.why}
                </p>
              )}
              {plane.how_to_absorb && (
                <p
                  className="rounded-lg px-2.5 py-2 text-[11.5px] leading-relaxed"
                  style={{
                    backgroundColor: pal.field + "29",
                    color: pal.emblem,
                  }}
                >
                  → {plane.how_to_absorb}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SamuraiCard({
  sensei,
  onOpen,
}: {
  sensei: Sensei;
  onOpen: () => void;
}) {
  const grade = gradeForPriority(sensei.priority);
  const pal = paletteForGrade(grade.index);
  const role = [sensei.occupation, sensei.company].filter(Boolean).join(" · ");
  const warmth = Math.round(sensei.warmth_score);
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <div
      onClick={onOpen}
      className="relative cursor-pointer overflow-hidden rounded-2xl border bg-card p-4 transition-colors active:bg-card-hover"
      style={{ borderColor: pal.ring + "44" }}
    >
      {/* grade-tinted glow */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl"
        style={{ background: pal.glow }}
      />

      {/* ── crest + identity ── */}
      <div className="relative flex gap-3.5">
        <div className="shrink-0">
          <SamuraiCrest grade={grade} size={64} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-[15px] font-bold text-white">
              {sensei.full_name}
            </p>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: pal.ring + "33", color: pal.emblem }}
            >
              {grade.kanji} {grade.title}
            </span>
          </div>
          {role && (
            <p className="mt-0.5 truncate text-[12px] text-neutral-500">
              {role}
            </p>
          )}
          {/* узы — bond strength (warmth) */}
          <div className="mt-2.5">
            <div className="mb-1 flex items-center justify-between text-[10px] text-neutral-500">
              <span className="uppercase tracking-widest">Узы</span>
              <span>{warmth}/100</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${warmth}%`,
                  background: `linear-gradient(90deg, ${pal.ring}, ${pal.emblem})`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── headline — one-line framing ── */}
      {sensei.headline && (
        <p className="relative mt-3 text-[13px] leading-snug text-neutral-200">
          {sensei.headline}
        </p>
      )}

      {/* ── patterns to absorb — the heart of the card ── */}
      {sensei.planes.length > 0 && (
        <div className="relative mt-3.5">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Чему учиться рядом
            </p>
            <span
              className="rounded-full px-1.5 py-px text-[10px] font-semibold leading-none"
              style={{ backgroundColor: pal.ring + "29", color: pal.emblem }}
            >
              {sensei.planes.length}
            </span>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          <div className="flex flex-col gap-2">
            {sensei.planes.map((pl, i) => (
              <PlaneRow key={i} plane={pl} index={i} pal={pal} />
            ))}
          </div>
        </div>
      )}

      {/* ── strategic note — folded away by default ── */}
      {sensei.chess_note && (
        <div className="relative mt-3">
          <button
            type="button"
            aria-expanded={noteOpen}
            onClick={(e) => {
              e.stopPropagation();
              setNoteOpen((v) => !v);
            }}
            className="flex w-full items-center gap-2 text-left"
          >
            <span
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: pal.emblem }}
            >
              Заметка стратега
            </span>
            <motion.span
              animate={{ rotate: noteOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              style={{ color: pal.emblem }}
              aria-hidden="true"
            >
              <ChevronDown size={14} />
            </motion.span>
            <div className="h-px flex-1 bg-white/5" />
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
                  className="mt-2 rounded-xl border-l-2 px-3 py-2 text-[12px] italic leading-relaxed text-neutral-300"
                  style={{
                    borderColor: pal.ring,
                    backgroundColor: pal.field + "1f",
                  }}
                >
                  「{sensei.chess_note}」
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── footer ── */}
      <div className="relative mt-3.5 flex items-center justify-between border-t border-white/5 pt-3 text-[10px] text-neutral-500">
        <span>
          {sensei.last_interaction_at
            ? `последний контакт · ${timeAgo(sensei.last_interaction_at)}`
            : "ещё не общались"}
        </span>
        <span>приоритет {sensei.priority}/100</span>
      </div>
    </div>
  );
}

// ── Empty dojo ────────────────────────────────────────────────
function EmptyDojo({ onGoToPeople }: { onGoToPeople: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-[#9a363f]/25 bg-gradient-to-br from-[#2a1416] via-[#1a1012] to-[#0f0f0f] p-8 text-center">
      <RisingSun />
      <div className="relative">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#9a363f]/30 bg-[#15140f] text-3xl text-[#f0c450]">
          侍
        </div>
        <h2 className="text-base font-semibold text-white">
          На твоём пути ещё нет сенсеев
        </h2>
        <p className="mx-auto mt-2 max-w-[300px] text-[12.5px] leading-relaxed text-neutral-400">
          Сенсеи появляются, когда агент находит контакт, который сильнее тебя
          в конкретной плоскости. Открой контакт и запусти «Зону роста» — или
          обнови все контакты сразу со страницы People.
        </p>
        <button
          onClick={onGoToPeople}
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-[#9a363f]/40 bg-[#9a363f]/15 px-4 py-2.5 text-sm font-medium text-[#e88c94] transition-colors active:bg-[#9a363f]/25"
        >
          К контактам
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
