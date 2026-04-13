export const WARMTH_COLORS: Record<string, string> = {
  new: "#ef4444",
  warming: "#eab308",
  warm: "#22c55e",
  cooling: "#f97316",
  paused: "#6b7280",
  archived: "#1f2937",
};

export const WARMTH_LABELS: Record<string, string> = {
  new: "Новый",
  warming: "Тёплый",
  warm: "Горячий",
  cooling: "Остывает",
  paused: "Пауза",
  archived: "Архив",
};

export function getWarmthColor(status: string): string {
  return WARMTH_COLORS[status] || WARMTH_COLORS.paused;
}

// ── Score-based color (gradient stops) ─────────────────────────────
// Returns a color that smoothly maps to the 0-100 score range,
// independent of the discrete status label.
const SCORE_STOPS: [number, [number, number, number]][] = [
  [0, [239, 68, 68]], // red
  [25, [249, 115, 22]], // orange
  [45, [234, 179, 8]], // yellow
  [65, [34, 197, 94]], // green
  [100, [16, 185, 129]], // emerald
];

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Returns an interpolated color for a given warmth score (0-100). */
export function getScoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < SCORE_STOPS.length - 1; i++) {
    const [lo, cLo] = SCORE_STOPS[i];
    const [hi, cHi] = SCORE_STOPS[i + 1];
    if (s <= hi) {
      const t = (s - lo) / (hi - lo);
      return lerpColor(cLo, cHi, t);
    }
  }
  return lerpColor(SCORE_STOPS.at(-1)![1], SCORE_STOPS.at(-1)![1], 0);
}

/** CSS gradient representing the full warmth spectrum (for bar background). */
export const WARMTH_GRADIENT =
  "linear-gradient(90deg, #ef4444 0%, #f97316 25%, #eab308 45%, #22c55e 70%, #10b981 100%)";

/** Score thresholds that align with server-side auto-transitions. */
export const WARMTH_THRESHOLDS = [
  { at: 20, label: "Тёплый" },
  { at: 50, label: "Горячий" },
];

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "";
  const now = Date.now();
  const then = new Date(date).getTime();
  if (isNaN(then)) return "";
  const diff = now - then;
  if (diff < 0) return "только что"; // future dates
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return "сегодня";
  const days = Math.floor(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн. назад`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} нед. назад`;
  const months = Math.floor(days / 30);
  return `${months} мес. назад`;
}
