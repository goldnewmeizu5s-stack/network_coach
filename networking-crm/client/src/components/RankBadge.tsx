import { ReactElement } from "react";
import { RankDef, TIER_PALETTE } from "../lib/rank";

// ──────────────────────────────────────────────────────────────
// RankBadge — shoulder-board ("погон") SVG.
// Tier determines field color and ornamentation:
//   recruit: plain field
//   nco    : 1–5 horizontal "lychki" stripes
//   officer: 1 red vertical bar + gold stars on it
//   senior : 2 red vertical bars + gold stars between
//   general: plain field + large gold stars + zig-zag gold embroidery
// ──────────────────────────────────────────────────────────────

interface Props {
  rank: Pick<RankDef, "tier" | "stars" | "bars" | "chevrons" | "index">;
  // Rendered height in px. Width follows the 100:180 aspect automatically.
  size?: number;
  className?: string;
  // If true, animates a subtle sheen across the board.
  shine?: boolean;
}

function Star({
  cx,
  cy,
  r,
  fill,
  stroke = "rgba(0,0,0,0.25)",
}: {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  stroke?: string;
}) {
  // 5-pointed star polygon
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`);
  }
  return (
    <polygon
      points={pts.join(" ")}
      fill={fill}
      stroke={stroke}
      strokeWidth={0.6}
      strokeLinejoin="round"
    />
  );
}

function evenlySpacedYs(count: number, top: number, bottom: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(top + bottom) / 2];
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, i) => top + step * i);
}

export default function RankBadge({
  rank,
  size = 140,
  className,
  shine = false,
}: Props) {
  const palette = TIER_PALETTE[rank.tier];
  const width = Math.round((size * 100) / 180);
  const gid = `rb-${rank.tier}-${rank.index}`;

  // Strap paths (outer trim and inner field)
  const outer =
    "M5 30 L5 172 Q5 176 9 176 L91 176 Q95 176 95 172 L95 30 Q95 5 50 5 Q5 5 5 30 Z";
  const inner =
    "M9 32 L9 170 Q9 171 10 171 L90 171 Q91 171 91 170 L91 32 Q91 11 50 11 Q9 11 9 32 Z";

  // Tier-specific content
  const content: ReactElement[] = [];

  if (rank.tier === "nco" && rank.chevrons > 0) {
    // Up to 5 horizontal gold "lychki" at the lower half.
    const count = Math.min(rank.chevrons, 5);
    const stripeCount = count <= 3 ? count : count === 4 ? 1 : 2;
    const stripeTall = count >= 4;
    const baseY = 145;
    const gap = 9;
    for (let i = 0; i < stripeCount; i++) {
      const h = stripeTall ? 10 : 5;
      const y = baseY - i * gap - (stripeTall && i === 1 ? 6 : 0);
      content.push(
        <rect
          key={`s${i}`}
          x={18}
          y={y}
          width={64}
          height={h}
          fill={palette.accent}
          rx={1.5}
        />,
      );
    }
    // Старшина (5): add a vertical gold stripe down the centre
    if (count === 5) {
      content.push(
        <rect
          key="vert"
          x={46}
          y={55}
          width={8}
          height={80}
          fill={palette.accent}
          rx={1.5}
        />,
      );
    }
  }

  if (rank.tier === "officer" || rank.tier === "senior") {
    // Red vertical bar(s)
    const barColor = "#c32b2b";
    if (rank.bars === 1) {
      content.push(
        <rect
          key="bar1"
          x={44}
          y={32}
          width={12}
          height={140}
          fill={barColor}
        />,
      );
    } else if (rank.bars === 2) {
      content.push(
        <rect
          key="bar1"
          x={28}
          y={32}
          width={8}
          height={140}
          fill={barColor}
        />,
      );
      content.push(
        <rect
          key="bar2"
          x={64}
          y={32}
          width={8}
          height={140}
          fill={barColor}
        />,
      );
    }

    // Stars — along the vertical axis for officers, between bars for senior.
    const starCount = rank.stars;
    const starR = rank.tier === "officer" ? 8 : 8;
    const ys = evenlySpacedYs(starCount, 60, 150);
    for (let i = 0; i < starCount; i++) {
      content.push(
        <Star
          key={`star${i}`}
          cx={50}
          cy={ys[i]}
          r={starR}
          fill={palette.star}
        />,
      );
    }
  }

  if (rank.tier === "general") {
    // Gold zig-zag embroidery along the edges
    const embroidery: string[] = [];
    for (let y = 30; y <= 170; y += 8) {
      embroidery.push(`M12 ${y} l5 -4 l-5 -4`);
      embroidery.push(`M88 ${y} l-5 -4 l5 -4`);
    }
    content.push(
      <path
        key="emb"
        d={embroidery.join(" ")}
        stroke={palette.accent}
        strokeWidth={1.2}
        fill="none"
        opacity={0.85}
      />,
    );

    const starR = rank.stars === 5 ? 14 : 11;
    const ys = evenlySpacedYs(rank.stars, 55, 155);
    for (let i = 0; i < rank.stars; i++) {
      content.push(
        <Star
          key={`gs${i}`}
          cx={50}
          cy={ys[i]}
          r={starR}
          fill={palette.star}
        />,
      );
    }

    // Marshal gets an extra laurel ring around the big star
    if (rank.stars === 5) {
      content.push(
        <circle
          key="laurel"
          cx={50}
          cy={ys[0] ?? 90}
          r={20}
          fill="none"
          stroke={palette.accent}
          strokeWidth={1.5}
          strokeDasharray="2 2"
          opacity={0.8}
        />,
      );
    }
  }

  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 100 180"
      className={className}
      aria-label={`Погон: ${rank.tier}`}
    >
      <defs>
        <linearGradient id={`${gid}-field`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.base} stopOpacity={1} />
          <stop
            offset="50%"
            stopColor={palette.base}
            stopOpacity={0.85}
          />
          <stop offset="100%" stopColor="#000" stopOpacity={0.35} />
        </linearGradient>
        <linearGradient id={`${gid}-trim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.accent} stopOpacity={1} />
          <stop
            offset="100%"
            stopColor={palette.trim}
            stopOpacity={0.85}
          />
        </linearGradient>
        <radialGradient id={`${gid}-glow`} cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor={palette.glow} stopOpacity={0.9} />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>

      {/* Outer glow */}
      <rect
        x={-10}
        y={-10}
        width={120}
        height={200}
        fill={`url(#${gid}-glow)`}
      />

      {/* Gold/trim edge */}
      <path d={outer} fill={`url(#${gid}-trim)`} />

      {/* Field */}
      <path d={inner} fill={`url(#${gid}-field)`} />

      {/* Tier-specific ornamentation */}
      {content}

      {/* Button at the neck (top) */}
      <circle cx={50} cy={24} r={5} fill={palette.accent} />
      <circle
        cx={50}
        cy={24}
        r={3.2}
        fill="none"
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={0.6}
      />
      <circle
        cx={48.5}
        cy={22.5}
        r={1.1}
        fill="rgba(255,255,255,0.7)"
      />

      {/* Sheen */}
      {shine && (
        <rect
          x={15}
          y={11}
          width={10}
          height={160}
          fill="rgba(255,255,255,0.08)"
          transform="skewX(-10)"
        />
      )}
    </svg>
  );
}
