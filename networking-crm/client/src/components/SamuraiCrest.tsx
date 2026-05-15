import { useId } from "react";
import { SamuraiGrade, paletteForGrade } from "../lib/samurai";
import SamuraiFigure from "./SamuraiFigure";

// ──────────────────────────────────────────────────────────────
// SamuraiCrest — a kamon-style mount with an actual samurai
// figure inside. The grade drives the art:
//   - which warrior figure is drawn (5 distinct silhouettes)
//   - the palette: steel → indigo → crimson → crimson+gold → black+gold
//   - crossed katana stay behind the disc as the family crest mount
// ──────────────────────────────────────────────────────────────

interface Props {
  grade: SamuraiGrade;
  // Rendered size in px (square viewBox).
  size?: number;
  className?: string;
  // Animated sheen sweep across the disc.
  shine?: boolean;
}

// One katana, drawn pointing straight up, centred on (50,50). The crest
// renders it twice, rotated ±27°, so the pair crosses behind the disc.
function Katana({ blade, tsuba }: { blade: string; tsuba: string }) {
  return (
    <g>
      {/* blade — tapers to a kissaki tip at the top */}
      <path d="M48.6 58 L48.6 16 L50 8 L51.4 16 L51.4 58 Z" fill={blade} />
      <line
        x1={50}
        y1={54}
        x2={50}
        y2={12}
        stroke="rgba(255,255,255,0.4)"
        strokeWidth={0.5}
      />
      {/* tsuba — guard */}
      <ellipse cx={50} cy={58} rx={6} ry={2.6} fill={tsuba} />
      {/* tsuka — handle */}
      <rect x={48.4} y={58} width={3.2} height={30} rx={1.2} fill="#1f1f1f" />
      {/* ito — handle wrap */}
      <path
        d="M48.4 64 L51.6 67 M48.4 70 L51.6 73 M48.4 76 L51.6 79 M48.4 82 L51.6 85"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={0.7}
      />
      {/* kashira — pommel */}
      <circle cx={50} cy={88.5} r={2.3} fill="#2e2e2e" />
    </g>
  );
}

export default function SamuraiCrest({
  grade,
  size = 120,
  className,
  shine = false,
}: Props) {
  const p = paletteForGrade(grade.index);
  const uid = useId().replace(/:/g, "");
  const fieldId = `sc-field-${uid}`;
  const glowId = `sc-glow-${uid}`;
  const clipId = `sc-clip-${uid}`;

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
          <stop offset="68%" stopColor={p.field} stopOpacity={0.92} />
          <stop offset="100%" stopColor="#000" stopOpacity={0.6} />
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
      <rect x={-12} y={-12} width={124} height={124} fill={`url(#${glowId})`} />

      {/* crossed katana behind the disc */}
      <g transform="rotate(-27 50 50)">
        <Katana blade={p.blade} tsuba={p.tsuba} />
      </g>
      <g transform="rotate(27 50 50)">
        <Katana blade={p.blade} tsuba={p.tsuba} />
      </g>

      {/* disc — trim ring + field */}
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

      {/* samurai figure inside the disc */}
      <g clipPath={`url(#${clipId})`}>
        <SamuraiFigure grade={grade} pal={p} />

        {/* sheen */}
        {shine && (
          <rect
            x={16}
            y={4}
            width={9}
            height={92}
            fill="rgba(255,255,255,0.12)"
            transform="skewX(-12)"
          >
            <animate
              attributeName="x"
              from={4}
              to={70}
              dur="2.6s"
              repeatCount="indefinite"
            />
          </rect>
        )}
      </g>
    </svg>
  );
}
