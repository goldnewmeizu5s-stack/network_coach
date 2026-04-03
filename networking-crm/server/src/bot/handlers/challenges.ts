import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  generateDailyChallenge,
  generateAlternativeChallenges,
} from "../../services/challenge-engine";
import { setState, getState, clearState } from "../state";

const CATEGORY_EMOJI: Record<string, string> = {
  conversation: "🗣️",
  follow_up: "🤝",
  digital: "📱",
  skill: "🎯",
  mindset: "🧠",
  stretch: "🔥",
};

const CATEGORY_LABEL: Record<string, string> = {
  conversation: "Разговор",
  follow_up: "Follow-up",
  digital: "Digital",
  skill: "Навык",
  mindset: "Мышление",
  stretch: "Вызов",
};

export function registerChallengeHandlers(bot: Telegraf) {
  bot.action("challenge", handleChallengeMenu);
  bot.action(/^challenge_accept:(.+)$/, handleAccept);
  bot.action("challenge_another", handleAnother);
  bot.action(/^challenge_too_hard:(.+)$/, handleTooHard);
  bot.action(/^challenge_complete:(.+)$/, handleComplete);
  bot.action(/^challenge_rate:(.+):(\d)$/, handleRate);
  bot.action(/^challenge_finish:(.+):(\d):noreflection$/, handleFinishNoReflection);
  bot.action(/^challenge_skip:(.+)$/, handleSkip);
  bot.action("challenge_stats", handleStats);
}

// ── Helpers ───────────────────────────────────────────────

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

function difficultyBar(d: number): string {
  return "●".repeat(d) + "○".repeat(10 - d);
}

function starsStr(n: number): string {
  return "⭐".repeat(n) + "☆".repeat(5 - n);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function getStreak(): Promise<number> {
  const yearAgo = new Date(Date.now() - 365 * 86400000);
  const allCompleted = await prisma.challenge.findMany({
    where: { status: "completed", date: { gte: yearAgo } },
    select: { date: true },
  });
  const completedDays = new Set(
    allCompleted.map((c: { date: Date }) => c.date.toISOString().slice(0, 10)),
  );

  let streak = 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const day = new Date(now.getTime() - i * 86400000);
    if (completedDays.has(day.toISOString().slice(0, 10))) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

async function updateStreak(): Promise<void> {
  const user = await prisma.user.findFirst();
  if (!user) return;

  const prefs = (user.preferences as Record<string, unknown>) || {};
  const today = new Date().toDateString();
  const lastStreakDate = (prefs.last_streak_date as string) || "";
  const currentStreak = (prefs.challenge_streak as number) || 0;

  if (lastStreakDate === today) return;

  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const newStreak = lastStreakDate === yesterday ? currentStreak + 1 : 1;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      preferences: {
        ...prefs,
        challenge_streak: newStreak,
        last_streak_date: today,
      },
    },
  });
}

// ── Card rendering ────────────────────────────────────────

interface ChallengeWithMethod {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: number;
  status: string;
  rating: number | null;
  reflection: string | null;
  methodology?: { title: string; source: string } | null;
}

function renderChallengeCard(ch: ChallengeWithMethod, streak: number): string {
  const catEmoji = CATEGORY_EMOJI[ch.category] || "🎯";
  const lines = [
    "🎯 <b>Челлендж дня</b>",
    "",
    `${catEmoji} <b>${escapeHtml(ch.title)}</b>`,
    `Сложность: ${difficultyBar(ch.difficulty)} (${ch.difficulty}/10)`,
    "",
    escapeHtml(ch.description),
  ];

  if (ch.methodology) {
    lines.push(
      "",
      `📚 <i>По методу: ${escapeHtml(ch.methodology.title)}, ${escapeHtml(ch.methodology.source)}</i>`,
    );
  }

  lines.push("", `🔥 Streak: ${streak} ${dayWord(streak)}`);

  return lines.join("\n");
}

function challengeKeyboard(ch: ChallengeWithMethod) {
  switch (ch.status) {
    case "pending":
      return Markup.inlineKeyboard([
        [
          Markup.button.callback("💪 Принять", `challenge_accept:${ch.id}`),
          Markup.button.callback("🔄 Другой", "challenge_another"),
        ],
        [Markup.button.callback("😰 Слишком сложно", `challenge_too_hard:${ch.id}`)],
        [
          Markup.button.callback("📊 Статистика", "challenge_stats"),
          Markup.button.callback("🏠 Меню", "main_menu"),
        ],
      ]);
    case "accepted":
      return Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Выполнено!", `challenge_complete:${ch.id}`),
          Markup.button.callback("❌ Не вышло", `challenge_skip:${ch.id}`),
        ],
        [
          Markup.button.callback("📊 Статистика", "challenge_stats"),
          Markup.button.callback("🏠 Меню", "main_menu"),
        ],
      ]);
    case "completed":
      return Markup.inlineKeyboard([
        [Markup.button.callback("📊 Статистика", "challenge_stats")],
        [Markup.button.callback("🏠 Меню", "main_menu")],
      ]);
    default:
      // skipped / too_hard
      return Markup.inlineKeyboard([
        [Markup.button.callback("🏠 Меню", "main_menu")],
      ]);
  }
}

function dayWord(n: number): string {
  const abs = Math.abs(n);
  if (abs % 10 === 1 && abs % 100 !== 11) return "день";
  if (abs % 10 >= 2 && abs % 10 <= 4 && (abs % 100 < 10 || abs % 100 >= 20))
    return "дня";
  return "дней";
}

// ── Handlers ──────────────────────────────────────────────

async function handleChallengeMenu(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const { start, end } = todayRange();
    let challenges = await prisma.challenge.findMany({
      where: { date: { gte: start, lt: end } },
      include: { methodology: { select: { title: true, source: true } } },
      orderBy: { created_at: "asc" },
    });

    if (challenges.length === 0) {
      const main = await generateDailyChallenge();
      const alts = await generateAlternativeChallenges();
      const ids = [main.id, ...alts.map((a: { id: string }) => a.id)];
      challenges = await prisma.challenge.findMany({
        where: { id: { in: ids } },
        include: { methodology: { select: { title: true, source: true } } },
        orderBy: { created_at: "asc" },
      });
    }

    const main = challenges[0];
    if (!main) {
      await ctx.reply("❌ Не удалось загрузить челлендж.");
      return;
    }

    const streak = await getStreak();
    const text = renderChallengeCard(main, streak);

    if (main.status === "completed" && main.rating) {
      const completedText =
        text +
        `\n\n✅ Выполнено! ${starsStr(main.rating)}` +
        (main.reflection ? `\n📝 "${escapeHtml(main.reflection)}"` : "");
      await editOrReply(ctx, completedText, challengeKeyboard(main));
    } else if (main.status === "skipped" || main.status === "too_hard") {
      const label = main.status === "skipped" ? "Пропущено" : "Слишком сложно";
      await editOrReply(ctx, text + `\n\n${label}`, challengeKeyboard(main));
    } else {
      await editOrReply(ctx, text, challengeKeyboard(main));
    }
  } catch (err) {
    logger.error("challenge menu error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка загрузки");
  }
}

async function handleAccept(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const id = match[1];

  try {
    await ctx.answerCbQuery("💪 Принято!");

    await prisma.challenge.update({
      where: { id },
      data: { status: "accepted" },
    });

    const ch = await prisma.challenge.findUnique({
      where: { id },
      include: { methodology: { select: { title: true, source: true } } },
    });
    if (!ch) return;

    const streak = await getStreak();
    const text = renderChallengeCard(ch, streak);
    await editOrReply(ctx, text, challengeKeyboard(ch));
  } catch (err) {
    logger.error("challenge accept error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleAnother(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const { start, end } = todayRange();
    const challenges = await prisma.challenge.findMany({
      where: { date: { gte: start, lt: end }, status: "pending" },
      include: { methodology: { select: { title: true, source: true } } },
      orderBy: { created_at: "asc" },
    });

    // Find the next pending alternative (skip first which is main if pending)
    const pendingAlts = challenges.slice(1);
    const alt = pendingAlts[0];

    if (!alt) {
      await ctx.reply("Это последний вариант на сегодня.", {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🏠 Меню", "main_menu")],
        ]),
      });
      return;
    }

    const streak = await getStreak();
    const text = renderChallengeCard(alt, streak);
    await editOrReply(ctx, text, challengeKeyboard(alt));
  } catch (err) {
    logger.error("challenge another error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleTooHard(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const id = match[1];

  try {
    await ctx.answerCbQuery();

    await prisma.challenge.update({
      where: { id },
      data: { status: "too_hard" },
    });

    await editOrReply(ctx, "Понял, завтра подберу полегче 💙", Markup.inlineKeyboard([
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]));
  } catch (err) {
    logger.error("challenge too_hard error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleComplete(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const id = match[1];

  try {
    await ctx.answerCbQuery();

    const buttons = [1, 2, 3, 4, 5].map((n) =>
      Markup.button.callback(starsStr(n), `challenge_rate:${id}:${n}`),
    );

    await editOrReply(ctx, "Как прошло? Оцени от 1 до 5:", Markup.inlineKeyboard(
      buttons.map((b) => [b]),
    ));
  } catch (err) {
    logger.error("challenge complete error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleRate(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const id = match[1];
  const rating = parseInt(match[2], 10);

  try {
    await ctx.answerCbQuery();

    setState(ctx.chat!.id, "awaiting_reflection", {
      challengeId: id,
      rating,
    });

    await editOrReply(
      ctx,
      "✍️ Хочешь записать рефлексию? Напиши пару слов или нажми пропустить.",
      Markup.inlineKeyboard([
        [Markup.button.callback("Пропустить", `challenge_finish:${id}:${rating}:noreflection`)],
      ]),
    );
  } catch (err) {
    logger.error("challenge rate error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleFinishNoReflection(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const id = match[1];
  const rating = parseInt(match[2], 10);

  try {
    await ctx.answerCbQuery();
    clearState(ctx.chat!.id);
    await completeChallenge(ctx, id, rating, null);
  } catch (err) {
    logger.error("challenge finish error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

/** Called from text handler when awaiting_reflection */
export async function handleReflectionText(
  ctx: Context,
  challengeId: string,
  rating: number,
  reflection: string,
) {
  await completeChallenge(ctx, challengeId, rating, reflection);
}

async function completeChallenge(
  ctx: Context,
  id: string,
  rating: number,
  reflection: string | null,
) {
  try {
    await prisma.challenge.update({
      where: { id },
      data: {
        status: "completed",
        completed_at: new Date(),
        rating: Math.max(1, Math.min(5, rating)),
        ...(reflection && { reflection }),
      },
    });

    try {
      await updateStreak();
    } catch (err) {
      logger.error("streak update failed", { error: String(err) });
    }

    const streak = await getStreak();

    const lines = ["🎉 Отличная работа!", "", starsStr(rating)];
    if (reflection) {
      lines.push(`📝 "${escapeHtml(reflection)}"`);
    }
    lines.push("", `🔥 Streak: ${streak} ${dayWord(streak)} подряд!`);

    if (streak > 0 && streak % 5 === 0) {
      lines.push("", `🎉🎉🎉 ${streak} ${dayWord(streak)} подряд! Ты в ударе!`);
    }

    await editOrReply(ctx, lines.join("\n"), Markup.inlineKeyboard([
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]));
  } catch (err) {
    logger.error("challenge complete error", { error: String(err) });
    await ctx.reply("❌ Ошибка сохранения.");
  }
}

async function handleSkip(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const id = match[1];

  try {
    await ctx.answerCbQuery();

    await prisma.challenge.update({
      where: { id },
      data: { status: "skipped" },
    });

    await editOrReply(ctx, "Не беда. Завтра новый день! 💙", Markup.inlineKeyboard([
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]));
  } catch (err) {
    logger.error("challenge skip error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleStats(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const streak = await getStreak();

    // Weekly data
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
    const weekChallenges = await prisma.challenge.findMany({
      where: { date: { gte: weekStart } },
      select: { date: true, status: true },
    });

    // Build weekly visual
    const weekDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart.getTime() + i * 86400000);
      const dayStr = day.toISOString().slice(0, 10);
      const ch = weekChallenges.find(
        (c: { date: Date; status: string }) => c.date.toISOString().slice(0, 10) === dayStr,
      );
      if (ch && ch.status === "completed") {
        weekDays.push("✅");
      } else if (ch) {
        weekDays.push("⬜");
      } else {
        weekDays.push("⬜");
      }
    }

    // 7-day and 30-day stats
    const [stats7, stats30] = await Promise.all([
      getChallengeStats(7),
      getChallengeStats(30),
    ]);

    const lines = [
      "📊 <b>Статистика челленджей</b>",
      "",
      `📅 Эта неделя: ${weekDays.join("")}`,
      `📈 Выполнение (7 дней): ${stats7.rate}%`,
      `📈 Выполнение (30 дней): ${stats30.rate}%`,
      `🔥 Текущий streak: ${streak} ${dayWord(streak)}`,
    ];

    if (Object.keys(stats30.byCategory).length > 0) {
      lines.push("", "По категориям:");
      for (const [cat, data] of Object.entries(stats30.byCategory)) {
        const emoji = CATEGORY_EMOJI[cat] || "🎯";
        const label = CATEGORY_LABEL[cat] || cat;
        const pct =
          data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
        lines.push(
          `${emoji} ${label}: ${pct}% (${data.completed}/${data.total})`,
        );
      }
    }

    await editOrReply(ctx, lines.join("\n"), Markup.inlineKeyboard([
      [Markup.button.callback("← Назад", "challenge")],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]));
  } catch (err) {
    logger.error("challenge stats error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка загрузки");
  }
}

async function getChallengeStats(days: number) {
  const since = new Date(Date.now() - days * 86400000);
  const challenges = await prisma.challenge.findMany({
    where: { date: { gte: since } },
    select: { status: true, category: true },
  });

  const total = challenges.length;
  const completed = challenges.filter(
    (c: { status: string }) => c.status === "completed",
  ).length;

  const byCategory: Record<string, { total: number; completed: number }> = {};
  for (const c of challenges) {
    if (!byCategory[c.category]) {
      byCategory[c.category] = { total: 0, completed: 0 };
    }
    byCategory[c.category].total++;
    if (c.status === "completed") byCategory[c.category].completed++;
  }

  return {
    rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    byCategory,
  };
}

// ── Shared helpers ────────────────────────────────────────

function editOrReply(
  ctx: Context,
  text: string,
  keyboard: ReturnType<typeof Markup.inlineKeyboard>,
) {
  try {
    if (ctx.callbackQuery) {
      return ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard });
    }
  } catch {
    // fallback
  }
  return ctx.reply(text, { parse_mode: "HTML", ...keyboard });
}

async function safeAnswer(ctx: Context, text: string) {
  try {
    await ctx.answerCbQuery(text);
  } catch {
    // ignore
  }
}
