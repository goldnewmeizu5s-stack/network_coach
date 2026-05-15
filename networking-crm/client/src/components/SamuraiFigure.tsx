import { SamuraiGrade, SamuraiPalette } from "../lib/samurai";

// ──────────────────────────────────────────────────────────────
// SamuraiFigure — a small samurai character drawn INSIDE the
// crest disc. Each of the 5 grades has its own distinct figure,
// so progression visually reads as the warrior gearing up:
//   Bushi    — bare-headed warrior with a single katana
//   Kenshi   — swordsman in iaido draw, more dynamic
//   Tatsujin — two swords, calm master pose
//   Gunshi   — kabuto helmet + war fan, the strategist
//   Kensei   — horned kabuto + sword aloft, the legend
// All figures live inside a 100x100 viewBox, vertically centred
// around y = 50, sized to fit a disc of radius 32 at (50, 50).
// ──────────────────────────────────────────────────────────────

interface Props {
  grade: SamuraiGrade;
  pal: SamuraiPalette;
}

export default function SamuraiFigure({ grade, pal }: Props) {
  switch (grade.index) {
    case 0:
      return <Bushi pal={pal} />;
    case 1:
      return <Kenshi pal={pal} />;
    case 2:
      return <Tatsujin pal={pal} />;
    case 3:
      return <Gunshi pal={pal} />;
    case 4:
      return <Kensei pal={pal} />;
    default:
      return <Bushi pal={pal} />;
  }
}

// ── 1. Bushi — basic samurai ─────────────────────────────────
function Bushi({ pal }: { pal: SamuraiPalette }) {
  return (
    <g>
      {/* chonmage (topknot) */}
      <rect x="48.8" y="22.5" width="2.4" height="3.5" fill={pal.emblem} />
      <ellipse cx="50" cy="22" rx="2.2" ry="1.2" fill={pal.emblem} />
      {/* head */}
      <circle cx="50" cy="29" r="4.2" fill={pal.emblem} />
      {/* shoulders */}
      <path d="M40 39 Q50 35 60 39 L62 44 L38 44 Z" fill={pal.emblem} />
      {/* kimono body */}
      <path d="M40 44 L60 44 L61 58 L39 58 Z" fill={pal.emblem} opacity="0.95" />
      {/* kimono fold (vertical centre line) */}
      <line x1="50" y1="40" x2="50" y2="58" stroke={pal.field} strokeWidth="0.7" opacity="0.65" />
      {/* obi (belt) */}
      <rect x="39" y="55" width="22" height="3" fill={pal.tsuba} />
      <rect x="39" y="55" width="22" height="0.6" fill={pal.blade} opacity="0.55" />
      {/* hakama (skirt) */}
      <path d="M38 58 L62 58 L66 74 L34 74 Z" fill={pal.emblem} opacity="0.88" />
      {/* hakama pleats */}
      <line x1="45" y1="59" x2="42" y2="73" stroke={pal.field} strokeWidth="0.5" opacity="0.5" />
      <line x1="55" y1="59" x2="58" y2="73" stroke={pal.field} strokeWidth="0.5" opacity="0.5" />
      {/* katana — at the hip, diagonal */}
      <line x1="58" y1="56" x2="68" y2="48" stroke={pal.blade} strokeWidth="1.5" strokeLinecap="round" />
      <rect x="56.5" y="54.5" width="3" height="2" fill={pal.tsuba} />
    </g>
  );
}

// ── 2. Kenshi — swordsman in iaido draw ──────────────────────
function Kenshi({ pal }: { pal: SamuraiPalette }) {
  return (
    <g>
      {/* topknot */}
      <rect x="48.8" y="22" width="2.4" height="3.5" fill={pal.emblem} />
      <ellipse cx="50" cy="21.5" rx="2.2" ry="1.2" fill={pal.emblem} />
      {/* head — slightly tilted to suggest motion */}
      <circle cx="49" cy="28.5" r="4.2" fill={pal.emblem} />
      {/* shoulders — asymmetric, one extended */}
      <path d="M38 38 Q49 34 60 39 L63 44 L36 44 Z" fill={pal.emblem} />
      {/* extended arm (sword arm) */}
      <path d="M58 41 L72 47 L72 50 L58 47 Z" fill={pal.emblem} />
      {/* kimono body — slightly twisted */}
      <path d="M38 44 L60 44 L62 58 L37 58 Z" fill={pal.emblem} opacity="0.95" />
      <line x1="49" y1="40" x2="50" y2="58" stroke={pal.field} strokeWidth="0.7" opacity="0.65" />
      {/* obi */}
      <rect x="37" y="55" width="24" height="3" fill={pal.tsuba} />
      <rect x="37" y="55" width="24" height="0.6" fill={pal.blade} opacity="0.55" />
      {/* hakama in motion — wider on one side */}
      <path d="M36 58 L62 58 L68 74 L31 74 Z" fill={pal.emblem} opacity="0.88" />
      <line x1="43" y1="59" x2="39" y2="73" stroke={pal.field} strokeWidth="0.5" opacity="0.5" />
      <line x1="53" y1="59" x2="58" y2="73" stroke={pal.field} strokeWidth="0.5" opacity="0.5" />
      {/* katana drawn out — long horizontal blade across the figure */}
      <line x1="72" y1="48" x2="32" y2="32" stroke={pal.blade} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="71" y1="48.5" x2="33" y2="32.5" stroke="rgba(255,255,255,0.4)" strokeWidth="0.4" />
      {/* tsuba on the sword */}
      <ellipse cx="73" cy="48.6" rx="2.4" ry="1.2" fill={pal.tsuba} />
      {/* handle behind */}
      <rect x="73" y="47.8" width="6" height="1.8" fill="#1f1f1f" rx="0.4" />
    </g>
  );
}

// ── 3. Tatsujin — master with two swords ─────────────────────
function Tatsujin({ pal }: { pal: SamuraiPalette }) {
  return (
    <g>
      {/* topknot */}
      <rect x="48.8" y="22" width="2.4" height="3.5" fill={pal.emblem} />
      <ellipse cx="50" cy="21.5" rx="2.4" ry="1.3" fill={pal.emblem} />
      {/* head */}
      <circle cx="50" cy="28.5" r="4.4" fill={pal.emblem} />
      {/* shoulders — broader, calm */}
      <path d="M38 38 Q50 33 62 38 L64 44 L36 44 Z" fill={pal.emblem} />
      {/* haori chest pattern — diamond */}
      <path d="M50 38 L53 42 L50 46 L47 42 Z" fill={pal.tsuba} opacity="0.85" />
      {/* kimono body */}
      <path d="M38 44 L62 44 L62 58 L38 58 Z" fill={pal.emblem} opacity="0.95" />
      <line x1="50" y1="46" x2="50" y2="58" stroke={pal.field} strokeWidth="0.7" opacity="0.65" />
      {/* obi */}
      <rect x="38" y="55" width="24" height="3" fill={pal.tsuba} />
      <rect x="38" y="55" width="24" height="0.6" fill={pal.blade} opacity="0.55" />
      {/* hakama */}
      <path d="M37 58 L63 58 L67 74 L33 74 Z" fill={pal.emblem} opacity="0.88" />
      <line x1="44" y1="59" x2="41" y2="73" stroke={pal.field} strokeWidth="0.5" opacity="0.5" />
      <line x1="56" y1="59" x2="59" y2="73" stroke={pal.field} strokeWidth="0.5" opacity="0.5" />
      {/* daisho — TWO swords at the left hip, diagonal */}
      {/* katana (long) */}
      <line x1="36" y1="56" x2="22" y2="48" stroke={pal.blade} strokeWidth="1.6" strokeLinecap="round" />
      <rect x="34.5" y="54.8" width="3" height="2" fill={pal.tsuba} />
      {/* wakizashi (short) — above the katana */}
      <line x1="36" y1="52" x2="26" y2="46" stroke={pal.blade} strokeWidth="1.2" strokeLinecap="round" />
      <rect x="34.5" y="50.8" width="2.6" height="1.6" fill={pal.tsuba} />
    </g>
  );
}

// ── 4. Gunshi — strategist with kabuto + war fan ─────────────
function Gunshi({ pal }: { pal: SamuraiPalette }) {
  return (
    <g>
      {/* kabuto (helmet) — bowl */}
      <path d="M43 28 Q50 22 57 28 L58 33 L42 33 Z" fill={pal.tsuba} />
      <path d="M43 28 Q50 22 57 28 L58 33 L42 33 Z" fill="none" stroke={pal.emblem} strokeWidth="0.6" />
      {/* mae-date (forehead crest) — a vertical gold piece */}
      <path d="M48.5 25 L51.5 25 L50.5 20 L49.5 20 Z" fill={pal.emblem} />
      {/* fukigaeshi (side flaps) */}
      <path d="M40 30 L43 30 L43 35 L41 35 Z" fill={pal.tsuba} />
      <path d="M57 30 L60 30 L59 35 L57 35 Z" fill={pal.tsuba} />
      {/* face — partial visible below helmet */}
      <ellipse cx="50" cy="34" rx="3.4" ry="2.4" fill={pal.emblem} />
      {/* eye line */}
      <line x1="47.5" y1="33.5" x2="52.5" y2="33.5" stroke={pal.field} strokeWidth="0.8" opacity="0.85" />
      {/* sode (shoulder armor) */}
      <path d="M36 39 L40 38 L42 44 L36 44 Z" fill={pal.tsuba} />
      <path d="M64 39 L60 38 L58 44 L64 44 Z" fill={pal.tsuba} />
      {/* do (chest armor) — three plates */}
      <path d="M40 38 Q50 36 60 38 L60 44 L40 44 Z" fill={pal.emblem} />
      <line x1="40" y1="40.5" x2="60" y2="40.5" stroke={pal.field} strokeWidth="0.5" opacity="0.6" />
      <line x1="40" y1="42.5" x2="60" y2="42.5" stroke={pal.field} strokeWidth="0.5" opacity="0.6" />
      {/* lower torso plates */}
      <path d="M40 44 L60 44 L62 56 L38 56 Z" fill={pal.emblem} opacity="0.95" />
      <line x1="40" y1="47" x2="60" y2="47" stroke={pal.field} strokeWidth="0.5" opacity="0.55" />
      <line x1="40" y1="50" x2="60" y2="50" stroke={pal.field} strokeWidth="0.5" opacity="0.55" />
      <line x1="40" y1="53" x2="60" y2="53" stroke={pal.field} strokeWidth="0.5" opacity="0.55" />
      {/* kusazuri (skirt plates) */}
      <path d="M38 56 L62 56 L66 70 L34 70 Z" fill={pal.tsuba} opacity="0.9" />
      <line x1="44" y1="56" x2="42" y2="70" stroke={pal.field} strokeWidth="0.5" opacity="0.55" />
      <line x1="50" y1="56" x2="50" y2="70" stroke={pal.field} strokeWidth="0.5" opacity="0.55" />
      <line x1="56" y1="56" x2="58" y2="70" stroke={pal.field} strokeWidth="0.5" opacity="0.55" />
      {/* gunbai (war fan) raised in right hand */}
      <line x1="64" y1="42" x2="74" y2="32" stroke={pal.emblem} strokeWidth="0.9" />
      <ellipse cx="74" cy="31" rx="4" ry="5" fill={pal.emblem} transform="rotate(15 74 31)" />
      <ellipse cx="74" cy="31" rx="3" ry="4" fill={pal.field} transform="rotate(15 74 31)" opacity="0.6" />
      {/* small sun-mon on the fan */}
      <circle cx="74" cy="31" r="1.1" fill={pal.blade} />
    </g>
  );
}

// ── 5. Kensei — legendary master with horned kabuto ──────────
function Kensei({ pal }: { pal: SamuraiPalette }) {
  return (
    <g>
      {/* halo (legend aura) */}
      <circle cx="50" cy="30" r="9" fill="none" stroke={pal.emblem} strokeWidth="0.6" opacity="0.45" />
      <circle cx="50" cy="30" r="11" fill="none" stroke={pal.emblem} strokeWidth="0.4" opacity="0.25" />
      {/* kuwagata (horns) — large curving horns */}
      <path d="M40 27 Q34 18 31 22 Q36 22 41 30 Z" fill={pal.emblem} />
      <path d="M60 27 Q66 18 69 22 Q64 22 59 30 Z" fill={pal.emblem} />
      {/* kabuto bowl */}
      <path d="M42 28 Q50 21 58 28 L59 33 L41 33 Z" fill={pal.field} />
      <path d="M42 28 Q50 21 58 28 L59 33 L41 33 Z" fill="none" stroke={pal.emblem} strokeWidth="0.8" />
      {/* maedate (centre gold spike) */}
      <path d="M48.5 27 L51.5 27 L50.5 18 L49.5 18 Z" fill={pal.emblem} />
      <circle cx="50" cy="17.5" r="1.2" fill={pal.blade} />
      {/* fukigaeshi (side flaps with emblem accent) */}
      <path d="M39 30 L42 30 L42 36 L40 36 Z" fill={pal.field} />
      <path d="M58 30 L61 30 L60 36 L58 36 Z" fill={pal.field} />
      {/* mempo (face mask) — partial */}
      <path d="M46 33 Q50 36 54 33 L53 36 L47 36 Z" fill={pal.tsuba} />
      {/* eyes — glowing slit */}
      <line x1="47" y1="33.5" x2="48.8" y2="33.5" stroke={pal.blade} strokeWidth="0.9" />
      <line x1="51.2" y1="33.5" x2="53" y2="33.5" stroke={pal.blade} strokeWidth="0.9" />
      {/* sode (shoulder armor) */}
      <path d="M34 38 L40 37 L42 44 L34 44 Z" fill={pal.emblem} />
      <path d="M66 38 L60 37 L58 44 L66 44 Z" fill={pal.emblem} />
      {/* do (chest armor) — patterned */}
      <path d="M40 37 Q50 35 60 37 L60 45 L40 45 Z" fill={pal.field} />
      <path d="M40 37 Q50 35 60 37 L60 45 L40 45 Z" fill="none" stroke={pal.emblem} strokeWidth="0.5" />
      <line x1="40" y1="40" x2="60" y2="40" stroke={pal.emblem} strokeWidth="0.5" opacity="0.7" />
      <line x1="40" y1="43" x2="60" y2="43" stroke={pal.emblem} strokeWidth="0.5" opacity="0.7" />
      {/* central chest emblem (sun-mon) */}
      <circle cx="50" cy="41" r="1.5" fill={pal.emblem} />
      {/* lower torso */}
      <path d="M40 45 L60 45 L61 55 L39 55 Z" fill={pal.field} />
      <line x1="40" y1="48" x2="60" y2="48" stroke={pal.emblem} strokeWidth="0.4" opacity="0.6" />
      <line x1="40" y1="51" x2="60" y2="51" stroke={pal.emblem} strokeWidth="0.4" opacity="0.6" />
      {/* obi with gold sash */}
      <rect x="39" y="54" width="22" height="2.5" fill={pal.emblem} />
      {/* kusazuri (skirt plates) */}
      <path d="M38 56 L62 56 L66 70 L34 70 Z" fill={pal.field} />
      <path d="M38 56 L62 56 L66 70 L34 70 Z" fill="none" stroke={pal.emblem} strokeWidth="0.5" />
      <line x1="44" y1="56" x2="42" y2="70" stroke={pal.emblem} strokeWidth="0.4" opacity="0.55" />
      <line x1="50" y1="56" x2="50" y2="70" stroke={pal.emblem} strokeWidth="0.4" opacity="0.55" />
      <line x1="56" y1="56" x2="58" y2="70" stroke={pal.emblem} strokeWidth="0.4" opacity="0.55" />
      {/* katana raised aloft */}
      <line x1="64" y1="42" x2="82" y2="14" stroke={pal.blade} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="65" y1="42" x2="82.5" y2="14.5" stroke="rgba(255,255,255,0.5)" strokeWidth="0.4" />
      {/* tsuba */}
      <ellipse cx="64" cy="42" rx="2.4" ry="1.2" fill={pal.emblem} />
      {/* handle */}
      <rect x="60" y="41.4" width="5" height="1.6" fill="#1f1f1f" rx="0.4" transform="rotate(-30 62.5 42.2)" />
    </g>
  );
}
