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
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн. назад`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} нед. назад`;
  const months = Math.floor(days / 30);
  return `${months} мес. назад`;
}
