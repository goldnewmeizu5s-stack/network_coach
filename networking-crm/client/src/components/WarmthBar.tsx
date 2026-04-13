import {
  getScoreColor,
  getWarmthColor,
  WARMTH_GRADIENT,
  WARMTH_LABELS,
  WARMTH_THRESHOLDS,
} from "../lib/warmth";

/* ────────────────────────────────────────────────────────────────
   WarmthBar — gradient progress bar with threshold markers
   ──────────────────────────────────────────────────────────────── */

interface WarmthBarProps {
  score: number; // 0-100
  status: string; // warmth_status
  /** "sm" for list rows, "md" for profile pages */
  size?: "sm" | "md";
  /** Override bar color when the contact has a location glow */
  glowOverride?: { color: string; shadow: string } | null;
}

export default function WarmthBar({
  score,
  status,
  size = "sm",
  glowOverride,
}: WarmthBarProps) {
  const pct = Math.max(0, Math.min(100, score));
  const scoreColor = glowOverride ? glowOverride.color : getScoreColor(pct);
  const statusColor = getWarmthColor(status);
  const isMd = size === "md";

  return (
    <div className={`flex w-full flex-col ${isMd ? "gap-2" : "gap-0"}`}>
      {/* ── Status badge + score (md only) ── */}
      {isMd && (
        <div className="flex items-center justify-between">
          <span
            className="rounded-full px-3 py-1 text-xs font-medium text-white"
            style={{ backgroundColor: statusColor }}
          >
            {WARMTH_LABELS[status] || status}
          </span>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: scoreColor }}
          >
            {Math.round(pct)}
          </span>
        </div>
      )}

      {/* ── Bar container ── */}
      <div className="relative">
        {/* Track */}
        <div
          className={`overflow-hidden rounded-full ${
            isMd ? "h-2.5" : "h-[6px]"
          }`}
          style={{ backgroundColor: "rgba(64,64,80,0.5)" }}
        >
          {/* Gradient fill */}
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: glowOverride ? glowOverride.color : WARMTH_GRADIENT,
              // Clip the full-width gradient to only show the filled part
              backgroundSize: `${(100 / Math.max(pct, 1)) * 100}% 100%`,
              boxShadow: glowOverride
                ? glowOverride.shadow
                : `0 0 10px ${scoreColor}50, 0 0 4px ${scoreColor}30`,
            }}
          />
        </div>

        {/* Threshold markers (md only) */}
        {isMd &&
          WARMTH_THRESHOLDS.map((th) => (
            <div
              key={th.at}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `${th.at}%`, transform: "translateX(-50%)" }}
            >
              {/* Tick */}
              <div
                className="h-2.5 w-px"
                style={{
                  backgroundColor:
                    pct >= th.at
                      ? "rgba(255,255,255,0.35)"
                      : "rgba(255,255,255,0.12)",
                }}
              />
              {/* Label below the bar */}
              <span
                className="mt-1 text-[9px] leading-none"
                style={{
                  color:
                    pct >= th.at
                      ? "rgba(255,255,255,0.5)"
                      : "rgba(255,255,255,0.2)",
                }}
              >
                {th.label}
              </span>
            </div>
          ))}
      </div>

      {/* ── Inline label (sm only) ── */}
      {!isMd && (
        <div className="mt-1 flex items-center justify-between">
          <span
            className="text-[10px] font-medium leading-none"
            style={{ color: statusColor }}
          >
            {WARMTH_LABELS[status] || status}
          </span>
        </div>
      )}
    </div>
  );
}
