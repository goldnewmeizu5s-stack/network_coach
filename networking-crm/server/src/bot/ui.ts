import { Markup } from "telegraf";
import type { Context } from "telegraf";
import type { InlineKeyboardButton } from "telegraf/types";

type Hideable<B> = B & { hide?: boolean };
export type InlineButtonRow = Hideable<InlineKeyboardButton>[];
export type InlineButtons = InlineButtonRow[];

// ── Текстовые утилиты ────────────────────────────────────

/** Escape HTML для Telegram */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Склонение слова "день": 1 день, 2 дня, 5 дней */
export function dayWord(n: number): string {
  const abs = Math.abs(n);
  if (abs % 10 === 1 && abs % 100 !== 11) return "день";
  if (abs % 10 >= 2 && abs % 10 <= 4 && (abs % 100 < 10 || abs % 100 >= 20))
    return "дня";
  return "дней";
}

/** Форматирование даты: "12.03.2025" */
export function fmtDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Относительная дата: "сегодня", "вчера", "3 дн. назад", "2 нед. назад" */
export function relDate(date: Date | null): string {
  if (!date) return "нет данных";
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн. назад`;
  if (days < 30) return `${Math.floor(days / 7)} нед. назад`;
  return `${Math.floor(days / 30)} мес. назад`;
}

/** Форматирование времени: "14:30" */
export function fmtTime(date: Date): string {
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Короткая дата: "12.03" */
export function fmtDateShort(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

// ── Визуальные компоненты ────────────────────────────────

/** Прогресс-бар из символов: ████░░░░░░ 40% */
export function progressBar(value: number, max: number, width = 10): string {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const filled = Math.round((value / Math.max(max, 1)) * width);
  return "█".repeat(filled) + "░".repeat(width - filled) + ` ${pct}%`;
}

/** Difficulty dots для челленджей: ●●●●●○○○○○ */
export function difficultyDots(level: number, max = 10): string {
  return "●".repeat(level) + "○".repeat(max - level);
}

/** Stars string: ⭐⭐⭐☆☆ */
export function starsStr(n: number, max = 5): string {
  return "⭐".repeat(n) + "☆".repeat(max - n);
}

/** Warmth badge: 🔴 Новый */
export function warmthBadge(status: string): string {
  return `${warmthEmoji(status)} ${warmthLabel(status)}`;
}

/** Warmth emoji only */
export function warmthEmoji(status: string): string {
  return STATUS_EMOJI[status] || "⚪";
}

/** Warmth label only (русский) */
export function warmthLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}

/** Category emoji для челленджей */
export function categoryEmoji(category: string): string {
  return CATEGORY_EMOJI[category] || "🎯";
}

/** Category label (русский) */
export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] || category;
}

/** Urgency indicator для follow-ups */
export function urgencyBadge(dueDate: Date): { emoji: string; label: string } {
  const diff = dueDate.getTime() - Date.now();
  const days = Math.floor(diff / 86400000);
  if (days < 0) {
    const overdue = Math.abs(days);
    return { emoji: "🔴", label: `просрочено на ${overdue} ${dayWord(overdue)}` };
  }
  if (days === 0) return { emoji: "🟡", label: "сегодня" };
  if (days === 1) return { emoji: "🟡", label: "завтра" };
  if (days <= 7) return { emoji: "🟢", label: `через ${days} ${dayWord(days)}` };
  return { emoji: "⚪", label: `через ${days} ${dayWord(days)}` };
}

/** Priority indicator: ⬆️⬆️⬆️ (high) / ➡️ (normal) / ⬇️ (low) */
export function priorityIndicator(priority: number): string {
  if (priority >= 8) return "⬆️⬆️⬆️";
  if (priority >= 5) return "➡️";
  return "⬇️";
}

/** Разделитель секций */
export function divider(): string {
  return "─────────────────";
}

/** Тонкий разделитель */
export function thinDivider(): string {
  return "· · · · · · · · ·";
}

// ── Компоненты карточек ──────────────────────────────────

/** Заголовок карточки с emoji */
export function cardTitle(emoji: string, title: string): string {
  return `${emoji} <b>${title}</b>`;
}

/** Поле карточки (label + value) */
export function field(emoji: string, label: string, value: string): string {
  if (!label) return `${emoji} ${value}`;
  return `${emoji} ${label}: <b>${value}</b>`;
}

/** Числовой stat */
export function stat(emoji: string, value: number | string, label: string): string {
  return `${emoji} <b>${value}</b> ${label}`;
}

/** Компактный stat для inline */
export function inlineStat(value: number | string, label: string): string {
  return `${value} ${label}`;
}

/** Section header внутри карточки */
export function section(title: string): string {
  return `\n📌 <b>${title}</b>`;
}

/** Пустое состояние */
export function emptyState(emoji: string, message: string): string {
  return `${emoji} ${message}`;
}

/** Hint/подсказка мелким текстом */
export function hint(text: string): string {
  return `\n<i>${text}</i>`;
}

// ── Навигационные кнопки ─────────────────────────────────

export const nav = {
  back: (label: string, callback: string) =>
    Markup.button.callback(`← ${label}`, callback),
  menu: () => Markup.button.callback("🏠 Меню", "main_menu"),
  contacts: () => Markup.button.callback("👥 Контакты", "contacts"),
  followups: () => Markup.button.callback("📋 Follow-ups", "followups"),
  challenge: () => Markup.button.callback("🎯 Челлендж", "challenge"),
  settings: () => Markup.button.callback("⚙️ Настройки", "settings"),
  chat: () => Markup.button.callback("💬 AI-чат", "ai_chat"),
};

/** Стандартная нижняя строка навигации */
export function navRow(
  ...buttons: ReturnType<typeof Markup.button.callback>[]
): ReturnType<typeof Markup.button.callback>[] {
  return buttons;
}

/** Функция editOrReply — единая для всех handlers */
export async function editOrReply(
  ctx: Context,
  text: string,
  buttons: InlineButtons,
): Promise<unknown> {
  const keyboard = Markup.inlineKeyboard(buttons);
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard });
      return;
    }
  } catch {
    // fallback to reply if edit fails
  }
  return ctx.reply(text, { parse_mode: "HTML", ...keyboard });
}

/** Safe answer for callback queries */
export async function safeAnswer(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.answerCbQuery(text);
  } catch {
    // ignore
  }
}

// ── Markdown → Telegram HTML ─────────────────────────────

/**
 * Convert markdown (from Claude/AI) to Telegram-safe HTML.
 * Handles bold, italic, headings, lists, and escapes everything else.
 */
export function markdownToTelegramHtml(text: string): string {
  let result = text;

  // Remove ### headings → bold text
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Convert **bold** → <b>bold</b> (before single *)
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Convert __bold__ → <b>bold</b>
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // Convert *italic* → <i>italic</i> (but not ** which is already handled)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // Convert _italic_ → <i>italic</i> (but not __ which is already handled)
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<i>$1</i>");

  // Convert `code` → <code>code</code>
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Convert - list items → • (at line start)
  result = result.replace(/^[-*]\s+/gm, "• ");

  // Now escape HTML in non-tag parts
  // Split by existing tags to preserve them
  const TAG_RE = /(<\/?(?:b|i|u|s|code|pre|a(?:\s[^>]*)?)>)/g;
  const parts = result.split(TAG_RE);
  result = parts
    .map((part) => {
      if (TAG_RE.test(part)) {
        TAG_RE.lastIndex = 0;
        return part;
      }
      return part
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    })
    .join("");

  return result;
}

// ── XP & Rank System ────────────────────────────────

export interface RankInfo {
  rank: string;
  emoji: string;
  level: number;
  currentXp: number;
  nextLevelXp: number;
  progressInLevel: number;
}

const RANKS = [
  { name: "Новичок", emoji: "🌱", minXp: 0 },
  { name: "Знакомец", emoji: "👋", minXp: 50 },
  { name: "Коммуникатор", emoji: "💬", minXp: 150 },
  { name: "Нетворкер", emoji: "🌐", minXp: 350 },
  { name: "Коннектор", emoji: "⚡", minXp: 600 },
  { name: "Мастер связей", emoji: "👑", minXp: 1000 },
];

/** Calculate XP earned for a challenge based on difficulty */
export function calculateXp(difficulty: number, hadReflection: boolean): number {
  const base = difficulty * 10;
  const reflectionBonus = hadReflection ? 15 : 0;
  return base + reflectionBonus;
}

/** Get rank info for a given total XP */
export function getRankInfo(totalXp: number): RankInfo {
  let rankIndex = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (totalXp >= RANKS[i].minXp) {
      rankIndex = i;
      break;
    }
  }
  const current = RANKS[rankIndex];
  const next = RANKS[rankIndex + 1] || { minXp: current.minXp + 500 };
  const progressInLevel = next.minXp > current.minXp
    ? Math.round(((totalXp - current.minXp) / (next.minXp - current.minXp)) * 100)
    : 100;

  return {
    rank: current.name,
    emoji: current.emoji,
    level: rankIndex + 1,
    currentXp: totalXp,
    nextLevelXp: next.minXp,
    progressInLevel,
  };
}

/** Render rank badge: 🌐 Нетворкер (Ур.4) */
export function rankBadge(info: RankInfo): string {
  return `${info.emoji} ${info.rank} (Ур.${info.level})`;
}

/** Render XP progress bar */
export function xpProgressBar(info: RankInfo): string {
  const filled = Math.round((info.progressInLevel / 100) * 8);
  const empty = 8 - filled;
  return "▰".repeat(filled) + "▱".repeat(empty) + ` ${info.currentXp}/${info.nextLevelXp} XP`;
}

/** Difficulty label in Russian */
export function difficultyLabel(level: number): string {
  if (level <= 3) return "Легко";
  if (level <= 6) return "Средне";
  if (level <= 8) return "Сложно";
  return "Хардкор";
}

/** Time estimate badge */
export function timeBadge(minutes: number | null | undefined): string {
  if (!minutes) return "";
  if (minutes < 5) return `⚡ ~${minutes} мин`;
  if (minutes <= 15) return `⏱ ~${minutes} мин`;
  if (minutes <= 30) return `⏰ ~${minutes} мин`;
  return `🕐 ~${minutes} мин`;
}

/** Category accent line (decorative border) */
export function categoryAccent(category: string): string {
  const accents: Record<string, string> = {
    conversation: "┃🟣",
    follow_up: "┃🟢",
    digital: "┃🔵",
    skill: "┃🟡",
    mindset: "┃🟣",
    stretch: "┃🔴",
  };
  return accents[category] || "┃⚪";
}

// ── Variability helpers (anti-skip) ─────────────────────

/** Pick a random element from an array */
export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Pick N unique random elements */
export function pickRandomN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/** Get a seeded-by-day index (same result within one day, different across days) */
export function dailyVariant(variants: number): number {
  const day = new Date().toISOString().slice(0, 10);
  let hash = 0;
  for (let i = 0; i < day.length; i++) {
    hash = (hash * 31 + day.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % variants;
}

// ── Error formatting for debug ──────────────────────────

/** Format error for display in Telegram (truncated, escaped) */
export function fmtError(err: unknown): string {
  let msg: string;
  if (err instanceof Error) {
    msg = err.stack ? `${err.message}\n${err.stack.split("\n").slice(1, 4).join("\n")}` : err.message;
  } else {
    msg = String(err);
  }
  // Truncate to fit Telegram message limits
  if (msg.length > 1500) msg = msg.slice(0, 1500) + "...";
  return esc(msg);
}

// ── Константы ────────────────────────────────────────────

export const STATUS_EMOJI: Record<string, string> = {
  new: "🔴",
  warming: "🟡",
  warm: "🟢",
  cooling: "🟠",
  paused: "⚪",
  archived: "📦",
};

export const STATUS_LABEL: Record<string, string> = {
  new: "Новые",
  warming: "Тёплые",
  warm: "Горячие",
  cooling: "Остывают",
  paused: "Пауза",
  archived: "Архив",
  all: "Все",
};

export const CATEGORY_EMOJI: Record<string, string> = {
  conversation: "🗣️",
  follow_up: "🤝",
  digital: "📱",
  skill: "🎯",
  mindset: "🧠",
  stretch: "🔥",
};

export const CATEGORY_LABEL: Record<string, string> = {
  conversation: "Разговор",
  follow_up: "Follow-up",
  digital: "Digital",
  skill: "Навык",
  mindset: "Мышление",
  stretch: "Вызов",
};
