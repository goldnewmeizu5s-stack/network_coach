import { useId, ReactNode } from "react";
import { SamuraiGrade, paletteForGrade } from "../lib/samurai";

// ──────────────────────────────────────────────────────────────
// SamuraiFigure — a stylised samurai bust on a kamon-style disc.
// One figure per grade; the visual story climbs from a young
// apprentice with a hachimaki to an enlightened sword-saint with
// a halo and ornate kabuto. Colour scheme comes from the same
// palette as the kamon crest — so the family resemblance is kept.
// ──────────────────────────────────────────────────────────────

interface Props {
  grade: SamuraiGrade;
  size?: number;
  className?: string;
}

const SKIN: Record<number, string> = {
  0: "#ecd1ab",
  1: "#e8caa3",
  2: "#e3c098",
  3: "#dbb98c",
  4: "#cfa974",
};

const INK = "#1a0f08";

export default function SamuraiFigure({
  grade,
  size = 120,
  className,
}: Props) {
  const p = paletteForGrade(grade.index);
  const uid = useId().replace(/:/g, "");
  const fieldId = `sf-f-${uid}`;
  const glowId = `sf-g-${uid}`;
  const clipId = `sf-c-${uid}`;
  const skin = SKIN[grade.index] ?? SKIN[0];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-label={`Самурай: ${grade.title}`}
    >
      <defs>
        <radialGradient id={fieldId} cx="42%" cy="36%" r="72%">
          <stop offset="0%" stopColor={p.field} stopOpacity={1} />
          <stop offset="65%" stopColor={p.field} stopOpacity={0.94} />
          <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
        </radialGradient>
        <radialGradient id={glowId} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor={p.glow} />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <clipPath id={clipId}>
          <circle cx={50} cy={50} r={32} />
        </clipPath>
      </defs>

      {/* outer glow */}
      <rect x={-10} y={-10} width={120} height={120} fill={`url(#${glowId})`} />

      {/* disc — trim + field */}
      <circle cx={50} cy={50} r={35} fill={p.ring} />
      <circle
        cx={50}
        cy={50}
        r={35}
        fill="none"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={0.8}
      />
      <circle cx={50} cy={50} r={32} fill={`url(#${fieldId})`} />

      {/* the samurai bust, clipped inside the disc */}
      <g clipPath={`url(#${clipId})`}>
        {renderFigure(grade.index, p, skin)}
      </g>

      {/* tiny ground / stand (echoes the kamon stand visual) */}
      <ellipse
        cx={50}
        cy={86}
        rx={9}
        ry={1.4}
        fill="rgba(0,0,0,0.25)"
      />
    </svg>
  );
}

function renderFigure(
  index: number,
  p: {
    field: string;
    ring: string;
    emblem: string;
    blade: string;
    tsuba: string;
    glow: string;
  },
  skin: string,
): ReactNode {
  switch (index) {
    case 0:
      return <Bushi p={p} skin={skin} />;
    case 1:
      return <Kenshi p={p} skin={skin} />;
    case 2:
      return <Tatsujin p={p} skin={skin} />;
    case 3:
      return <Gunshi p={p} skin={skin} />;
    case 4:
      return <Kensei p={p} skin={skin} />;
    default:
      return <Bushi p={p} skin={skin} />;
  }
}

type Palette = {
  field: string;
  ring: string;
  emblem: string;
  blade: string;
  tsuba: string;
  glow: string;
};

// ── Grade 0 · Самурай (apprentice with hachimaki) ────────────
function Bushi({ p, skin }: { p: Palette; skin: string }) {
  return (
    <>
      {/* gi / body */}
      <path
        d="M22 92 L28 70 Q40 66 50 66 Q60 66 72 70 L78 92 Z"
        fill={p.field}
      />
      {/* gi collar V */}
      <path
        d="M43 66 L50 78 L57 66 Z"
        fill={p.ring}
        stroke="rgba(0,0,0,0.25)"
        strokeWidth={0.5}
      />
      {/* obi belt hint */}
      <rect x={28} y={84} width={44} height={2} fill={p.emblem} opacity={0.6} />
      {/* neck */}
      <rect x={46} y={61} width={8} height={9} fill={skin} />
      {/* head */}
      <ellipse cx={50} cy={50} rx={13} ry={14} fill={skin} />
      {/* hair top mass */}
      <path d="M36 47 Q40 33 50 32 Q60 33 64 47 Z" fill="#1d130b" />
      {/* side burns */}
      <path d="M37 50 L37 56 L39 58 L39 49 Z" fill="#1d130b" />
      <path d="M61 49 L61 58 L63 56 L63 50 Z" fill="#1d130b" />
      {/* chonmage topknot */}
      <ellipse cx={50} cy={31} rx={3.6} ry={2.5} fill="#1d130b" />
      <ellipse cx={50} cy={29} rx={2} ry={1.3} fill="#2a1c10" />
      {/* hachimaki (red band) */}
      <rect x={36} y={47.5} width={28} height={3} fill={p.emblem} />
      {/* knot tails on side */}
      <path d="M34 49 L29 51 L31 53 Z" fill={p.emblem} />
      <path d="M34 49 L30 55 L33 54 Z" fill={p.emblem} opacity={0.85} />
      {/* eyes */}
      <ellipse cx={45} cy={53} rx={1.3} ry={1.1} fill={INK} />
      <ellipse cx={55} cy={53} rx={1.3} ry={1.1} fill={INK} />
      {/* eyebrows — gentle */}
      <path
        d="M42 50.5 L47 50"
        stroke={INK}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M53 50 L58 50.5"
        stroke={INK}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      {/* mouth — neutral small */}
      <path
        d="M47.5 59 L52.5 59"
        stroke={INK}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </>
  );
}

// ── Grade 1 · Мечник (swordsman with light kabuto) ────────────
function Kenshi({ p, skin }: { p: Palette; skin: string }) {
  return (
    <>
      {/* body / armor */}
      <path
        d="M22 92 L26 70 Q40 64 50 64 Q60 64 74 70 L78 92 Z"
        fill={p.field}
      />
      {/* armor plate accent line */}
      <path
        d="M30 73 L70 73"
        stroke={p.emblem}
        strokeWidth={0.9}
        opacity={0.55}
      />
      <path
        d="M30 80 L70 80"
        stroke={p.emblem}
        strokeWidth={0.7}
        opacity={0.35}
      />
      {/* sword hilts crossed behind shoulders */}
      <g transform="rotate(-18 22 80)">
        <rect x={20.5} y={70} width={3} height={16} rx={1} fill="#1f160c" />
        <rect x={20} y={71} width={4} height={2} fill={p.blade} />
        <circle cx={22} cy={86} r={1.5} fill="#2a1c10" />
      </g>
      <g transform="rotate(18 78 80)">
        <rect x={76.5} y={70} width={3} height={16} rx={1} fill="#1f160c" />
        <rect x={76} y={71} width={4} height={2} fill={p.blade} />
        <circle cx={78} cy={86} r={1.5} fill="#2a1c10" />
      </g>
      {/* face skin (shows below kabuto rim) */}
      <ellipse cx={50} cy={51} rx={11} ry={11.5} fill={skin} />
      {/* kabuto bowl */}
      <path
        d="M34 48 Q34 31 50 28 Q66 31 66 48 L62.5 50 Q60 45 50 44 Q40 45 37.5 50 Z"
        fill={p.ring}
      />
      {/* helmet plate highlight */}
      <path
        d="M37 36 Q42 32 50 32 Q58 32 63 36"
        stroke={p.emblem}
        strokeWidth={0.7}
        fill="none"
        opacity={0.6}
      />
      {/* maedate (vertical forehead crest) */}
      <rect x={48.5} y={30} width={3} height={13} rx={0.6} fill={p.emblem} />
      {/* rim koshimaki */}
      <ellipse
        cx={50}
        cy={47}
        rx={16}
        ry={2.6}
        fill={p.field}
        stroke="rgba(0,0,0,0.3)"
        strokeWidth={0.5}
      />
      {/* eyes — focused dots */}
      <circle cx={45} cy={53} r={1.4} fill={INK} />
      <circle cx={55} cy={53} r={1.4} fill={INK} />
      {/* eyebrows — sharper */}
      <path
        d="M42 50 L47 51"
        stroke={INK}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <path
        d="M53 51 L58 50"
        stroke={INK}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      {/* mouth */}
      <path
        d="M47 60 L53 60"
        stroke={INK}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </>
  );
}

// ── Grade 2 · Мастер (master with mempo + side flares) ────────
function Tatsujin({ p, skin }: { p: Palette; skin: string }) {
  return (
    <>
      {/* body */}
      <path
        d="M20 92 L25 70 Q40 62 50 62 Q60 62 75 70 L80 92 Z"
        fill={p.field}
      />
      {/* chest gold trim */}
      <path
        d="M30 74 L70 74"
        stroke={p.emblem}
        strokeWidth={1}
        opacity={0.55}
      />
      <path
        d="M50 65 L50 88"
        stroke={p.emblem}
        strokeWidth={0.7}
        opacity={0.4}
      />
      {/* pauldrons (sode) */}
      <ellipse
        cx={25}
        cy={71}
        rx={6}
        ry={5}
        fill={p.ring}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={0.6}
      />
      <ellipse
        cx={75}
        cy={71}
        rx={6}
        ry={5}
        fill={p.ring}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={0.6}
      />
      <circle cx={25} cy={71} r={1.6} fill={p.emblem} />
      <circle cx={75} cy={71} r={1.6} fill={p.emblem} />

      {/* face (only upper half visible — mempo covers jaw) */}
      <ellipse cx={50} cy={51} rx={11} ry={12} fill={skin} />

      {/* mempo (jaw half-mask) */}
      <path
        d="M39 56 Q50 64 61 56 L63 65 Q50 71 37 65 Z"
        fill={p.ring}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={0.5}
      />
      {/* mempo mouth slit */}
      <path
        d="M45 62 L55 62"
        stroke="rgba(0,0,0,0.6)"
        strokeWidth={0.7}
        strokeLinecap="round"
      />
      {/* mempo whiskers (decorative) */}
      <path
        d="M43 64 L40 66 M57 64 L60 66"
        stroke={p.emblem}
        strokeWidth={0.7}
        opacity={0.7}
      />

      {/* kabuto bowl */}
      <path
        d="M33 47 Q33 28 50 25 Q67 28 67 47 L63.5 50 Q60 43 50 42 Q40 43 36.5 50 Z"
        fill={p.ring}
      />
      {/* highlight along helmet plate */}
      <path
        d="M37 34 Q44 30 50 30 Q56 30 63 34"
        stroke={p.emblem}
        strokeWidth={0.8}
        fill="none"
        opacity={0.65}
      />
      {/* fukikaeshi side flares */}
      <path
        d="M33 48 L25 41 L30 50 Z"
        fill={p.ring}
        stroke={p.emblem}
        strokeWidth={0.6}
      />
      <path
        d="M67 48 L75 41 L70 50 Z"
        fill={p.ring}
        stroke={p.emblem}
        strokeWidth={0.6}
      />
      {/* maedate sun disc */}
      <circle cx={50} cy={37} r={4} fill={p.emblem} />
      <circle cx={50} cy={37} r={1.3} fill={p.ring} />
      {/* rim */}
      <ellipse
        cx={50}
        cy={46}
        rx={17}
        ry={2.6}
        fill={p.field}
        stroke="rgba(0,0,0,0.3)"
        strokeWidth={0.5}
      />
      {/* eyes intense */}
      <ellipse cx={45} cy={52} rx={1.5} ry={1.2} fill={INK} />
      <ellipse cx={55} cy={52} rx={1.5} ry={1.2} fill={INK} />
      {/* eyebrows — sharply angled */}
      <path
        d="M41 49 L47 50.5"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <path
        d="M53 50.5 L59 49"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </>
  );
}

// ── Grade 3 · Стратег (horned helmet + war fan) ───────────────
function Gunshi({ p, skin }: { p: Palette; skin: string }) {
  return (
    <>
      {/* body */}
      <path
        d="M22 92 L26 70 Q40 62 50 62 Q60 62 74 70 L78 92 Z"
        fill={p.field}
      />
      {/* gold accents on armor */}
      <path
        d="M30 75 L70 75"
        stroke={p.emblem}
        strokeWidth={1}
        opacity={0.6}
      />
      {/* pauldrons gold */}
      <ellipse cx={25} cy={71} rx={6.2} ry={5} fill={p.emblem} />
      <ellipse cx={75} cy={71} rx={6.2} ry={5} fill={p.emblem} />
      <circle cx={25} cy={71} r={1.4} fill={p.ring} />
      <circle cx={75} cy={71} r={1.4} fill={p.ring} />

      {/* war fan (gunbai) held in front of chest */}
      <g>
        {/* handle */}
        <rect x={48.5} y={76} width={3} height={14} rx={0.8} fill="#1f160c" />
        {/* fan body */}
        <ellipse
          cx={50}
          cy={78}
          rx={11}
          ry={8}
          fill={p.emblem}
          stroke="rgba(0,0,0,0.45)"
          strokeWidth={0.6}
        />
        {/* fan ribs */}
        <path
          d="M40 76 L50 78 M44 73 L50 78 M50 71 L50 78 M56 73 L50 78 M60 76 L50 78 M42 81 L50 78 M58 81 L50 78"
          stroke="rgba(0,0,0,0.25)"
          strokeWidth={0.5}
        />
        {/* emblem in fan centre */}
        <circle cx={50} cy={77} r={2.5} fill={p.field} />
        <circle cx={50} cy={77} r={1} fill={p.emblem} />
      </g>

      {/* face */}
      <ellipse cx={50} cy={50} rx={11} ry={12} fill={skin} />
      {/* mempo */}
      <path
        d="M39 55 Q50 63 61 55 L63 64 Q50 70 37 64 Z"
        fill="#1f160c"
      />
      <path
        d="M45 61 L55 61"
        stroke={p.emblem}
        strokeWidth={0.7}
        opacity={0.7}
      />

      {/* kabuto bowl */}
      <path
        d="M33 47 Q33 28 50 25 Q67 28 67 47 L63.5 50 Q60 43 50 42 Q40 43 36.5 50 Z"
        fill={p.ring}
      />
      {/* gold edge */}
      <path
        d="M33 47 Q33 28 50 25 Q67 28 67 47"
        stroke={p.emblem}
        strokeWidth={1.2}
        fill="none"
      />
      {/* side flares */}
      <path
        d="M33 48 L24 41 L30 49 Z"
        fill={p.ring}
        stroke={p.emblem}
        strokeWidth={0.6}
      />
      <path
        d="M67 48 L76 41 L70 49 Z"
        fill={p.ring}
        stroke={p.emblem}
        strokeWidth={0.6}
      />

      {/* kuwagata — large gold antler crests */}
      <path
        d="M41 28 Q35 17 27 12 Q31 21 36 26 Q39 30 41 33 Z"
        fill={p.emblem}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={0.5}
      />
      <path
        d="M59 28 Q65 17 73 12 Q69 21 64 26 Q61 30 59 33 Z"
        fill={p.emblem}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={0.5}
      />
      {/* central crest disc */}
      <circle
        cx={50}
        cy={33}
        r={3.5}
        fill={p.emblem}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={0.5}
      />
      <circle cx={50} cy={33} r={1.3} fill={p.ring} />

      {/* rim */}
      <ellipse
        cx={50}
        cy={46}
        rx={17}
        ry={2.6}
        fill={p.field}
        stroke="rgba(0,0,0,0.3)"
        strokeWidth={0.5}
      />
      {/* eyes piercing */}
      <ellipse cx={45} cy={52} rx={1.5} ry={1.2} fill={INK} />
      <ellipse cx={55} cy={52} rx={1.5} ry={1.2} fill={INK} />
      {/* eyebrows */}
      <path
        d="M41 49 L47 51"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <path
        d="M53 51 L59 49"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </>
  );
}

// ── Grade 4 · Святой меча (halo + closed eyes) ───────────────
function Kensei({ p, skin }: { p: Palette; skin: string }) {
  return (
    <>
      {/* halo behind head */}
      <circle
        cx={50}
        cy={40}
        r={26}
        fill={p.emblem}
        opacity={0.14}
      />
      <circle
        cx={50}
        cy={40}
        r={22}
        fill="none"
        stroke={p.emblem}
        strokeWidth={1}
        opacity={0.55}
      />
      <circle
        cx={50}
        cy={40}
        r={26}
        fill="none"
        stroke={p.emblem}
        strokeWidth={0.6}
        opacity={0.3}
      />
      {/* aura rays */}
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <line
          key={deg}
          x1={50}
          y1={40}
          x2={50}
          y2={10}
          stroke={p.emblem}
          strokeWidth={0.5}
          opacity={0.25}
          transform={`rotate(${deg} 50 40)`}
        />
      ))}

      {/* body */}
      <path
        d="M22 92 L26 70 Q40 62 50 62 Q60 62 74 70 L78 92 Z"
        fill={p.field}
      />
      {/* armor gold trim */}
      <path
        d="M30 76 L70 76"
        stroke={p.emblem}
        strokeWidth={1.2}
        opacity={0.7}
      />
      <path
        d="M30 82 L70 82"
        stroke={p.emblem}
        strokeWidth={0.7}
        opacity={0.5}
      />
      <path
        d="M50 70 L50 90"
        stroke={p.emblem}
        strokeWidth={0.6}
        opacity={0.5}
      />
      {/* pauldrons gold */}
      <ellipse
        cx={25}
        cy={71}
        rx={6.5}
        ry={5}
        fill={p.emblem}
        stroke="rgba(0,0,0,0.5)"
        strokeWidth={0.6}
      />
      <ellipse
        cx={75}
        cy={71}
        rx={6.5}
        ry={5}
        fill={p.emblem}
        stroke="rgba(0,0,0,0.5)"
        strokeWidth={0.6}
      />
      <circle cx={25} cy={71} r={1.6} fill={p.ring} />
      <circle cx={75} cy={71} r={1.6} fill={p.ring} />

      {/* face */}
      <ellipse cx={50} cy={50} rx={11} ry={12} fill={skin} />
      {/* full mempo with grin */}
      <path
        d="M39 55 Q50 66 61 55 L63 65 Q50 71 37 65 Z"
        fill="#0e0703"
      />
      <path
        d="M50 64 Q47 62 44 62 M50 64 Q53 62 56 62"
        stroke={p.emblem}
        strokeWidth={0.7}
        fill="none"
        opacity={0.7}
      />

      {/* kabuto bowl — black lacquer */}
      <path
        d="M32 47 Q32 27 50 24 Q68 27 68 47 L64.5 50 Q60 42 50 41 Q40 42 35.5 50 Z"
        fill="#0e0703"
      />
      {/* gold trim on bowl */}
      <path
        d="M32 47 Q32 27 50 24 Q68 27 68 47"
        stroke={p.emblem}
        strokeWidth={1.4}
        fill="none"
      />
      {/* central sun emblem */}
      <circle cx={50} cy={33} r={5} fill={p.emblem} />
      <circle cx={50} cy={33} r={2.4} fill="#0e0703" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line
          key={a}
          x1={50}
          y1={33}
          x2={50}
          y2={26}
          stroke={p.emblem}
          strokeWidth={0.8}
          opacity={0.7}
          transform={`rotate(${a} 50 33)`}
        />
      ))}

      {/* side flares — black with gold edge */}
      <path
        d="M32 48 L23 41 L29 49 Z"
        fill="#0e0703"
        stroke={p.emblem}
        strokeWidth={0.8}
      />
      <path
        d="M68 48 L77 41 L71 49 Z"
        fill="#0e0703"
        stroke={p.emblem}
        strokeWidth={0.8}
      />

      {/* rim */}
      <ellipse
        cx={50}
        cy={46}
        rx={17.5}
        ry={2.6}
        fill="#0e0703"
        stroke={p.emblem}
        strokeWidth={0.7}
      />

      {/* closed enlightened eyes */}
      <path
        d="M42 52.5 Q45 54 48 52.5"
        stroke={INK}
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M52 52.5 Q55 54 58 52.5"
        stroke={INK}
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
      />
      {/* serene brows */}
      <path
        d="M42 49.5 L48 49"
        stroke={INK}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M52 49 L58 49.5"
        stroke={INK}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </>
  );
}
