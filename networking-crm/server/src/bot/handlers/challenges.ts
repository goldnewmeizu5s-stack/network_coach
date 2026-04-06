import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  generateDailyChallenge,
  generateAlternativeChallenges,
} from "../../services/challenge-engine";
import { setState, getState, clearState } from "../state";
import {
  esc,
  dayWord,
  divider,
  thinDivider,
  progressBar,
  difficultyDots as difficultyBar,
  starsStr,
  editOrReply,
  safeAnswer,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  fmtError,
} from "../ui";

export function registerChallengeHandlers(bot: Telegraf) {
  bot.action("challenge", handleChallengeMenu);
  bot.action(/^challenge_accept:(.+)$/, handleAccept);
  bot.action("challenge_another", handleAnother);
  bot.action(/^challenge_too_hard:(.+)$/, handleTooHard);
  bot.action(/^challenge_complete:(.+)$/, handleComplete);
  bot.action(/^challenge_rate:(.+):(\d)$/, handleRate);
  bot.action(/^ch_fin:(.+):(\d):nr$/, handleFinishNoReflection);
  bot.action(/^challenge_skip_rate:(.+)$/, handleSkipRate);
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

  // Completed state — different layout
  if (ch.status === "completed" && ch.rating) {
    const lines = [
      "🎯 <b>Челлендж дня</b>  ✅",
      divider(),
      "",
      `${catEmoji} <b>${esc(ch.title)}</b>`,
      starsStr(ch.rating),
    ];
    if (ch.reflection) {
      lines.push("", `📝 <i>"${esc(ch.reflection)}"</i>`);
    }
    lines.push("", thinDivider());
    if (streak > 0) {
      lines.push(`🔥 Streak: ${streak} ${dayWord(streak)} подряд!`);
    }
    return lines.join("\n");
  }

  // Accepted state — add motivation header
  const lines: string[] = [];
  if (ch.status === "accepted") {
    lines.push("✊ <b>Принято! Давай!</b>", "");
  }

  lines.push(
    "🎯 <b>Челлендж дня</b>",
    divider(),
    "",
    `${catEmoji} <b>${esc(ch.title)}</b>`,
    `${difficultyBar(ch.difficulty)} сложность ${ch.difficulty}/10`,
    "",
    esc(ch.description),
  );

  if (ch.methodology) {
    lines.push(
      "",
      `📚 <i>Метод: ${esc(ch.methodology.title)} (${esc(ch.methodology.source)})</i>`,
    );
  }

  lines.push("", thinDivider());
  if (streak > 0) {
    lines.push(`🔥 Streak: ${streak} ${dayWord(streak)}`);
  }

  return lines.join("\n");
}

function challengeButtons(ch: ChallengeWithMethod): ReturnType<typeof Markup.button.callback>[][] {
  switch (ch.status) {
    case "pending":
      return [
        [
          Markup.button.callback("💪 Принять", `challenge_accept:${ch.id}`),
          Markup.button.callback("🔄 Другой", "challenge_another"),
        ],
        [Markup.button.callback("😰 Сложно", `challenge_too_hard:${ch.id}`)],
        [
          Markup.button.callback("📊 Статистика", "challenge_stats"),
          Markup.button.callback("🏠 Меню", "main_menu"),
        ],
      ];
    case "accepted":
      return [
        [Markup.button.callback("✅ Выполнено!", `challenge_complete:${ch.id}`)],
        [Markup.button.callback("❌ Не получилось", `challenge_skip:${ch.id}`)],
        [
          Markup.button.callback("📊 Статистика", "challenge_stats"),
          Markup.button.callback("🏠 Меню", "main_menu"),
        ],
      ];
    case "completed":
      return [
        [
          Markup.button.callback("📊 Статистика", "challenge_stats"),
          Markup.button.callback("🏠 Меню", "main_menu"),
        ],
      ];
    default:
      // skipped / too_hard
      return [
        [Markup.button.callback("🏠 Меню", "main_menu")],
      ];
  }
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

    if (main.status === "skipped" || main.status === "too_hard") {
      const label = main.status === "skipped" ? "⏭ Пропущено" : "😰 Слишком сложно";
      await editOrReply(ctx, text + `\n\n${label}`, challengeButtons(main));
    } else {
      await editOrReply(ctx, text, challengeButtons(main));
    }
  } catch (err) {
    logger.error("challenge menu error", { error: String(err) });
    await ctx.reply(`❌ Ошибка загрузки челленджа:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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
    await editOrReply(ctx, text, challengeButtons(ch));
  } catch (err) {
    logger.error("challenge accept error", { error: String(err) });
    await ctx.reply(`❌ Ошибка принятия челленджа:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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
    await editOrReply(ctx, text, challengeButtons(alt));
  } catch (err) {
    logger.error("challenge another error", { error: String(err) });
    await ctx.reply(`❌ Ошибка загрузки альтернативы:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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

    await editOrReply(ctx, "Понял, завтра подберу полегче 💙", [
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
  } catch (err) {
    logger.error("challenge too_hard error", { error: String(err) });
    await ctx.reply(`❌ Ошибка:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

async function handleComplete(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const id = match[1];

  try {
    await ctx.answerCbQuery();

    const text = "🎉 <b>Как прошло?</b>\n\nОцени:";

    const buttons = [
      [
        Markup.button.callback("⭐1", `challenge_rate:${id}:1`),
        Markup.button.callback("⭐2", `challenge_rate:${id}:2`),
        Markup.button.callback("⭐3", `challenge_rate:${id}:3`),
        Markup.button.callback("⭐4", `challenge_rate:${id}:4`),
        Markup.button.callback("⭐5", `challenge_rate:${id}:5`),
      ],
      [Markup.button.callback("Пропустить оценку →", `challenge_skip_rate:${id}`)],
    ];

    await editOrReply(ctx, text, buttons);
  } catch (err) {
    logger.error("challenge complete error", { error: String(err) });
    await ctx.reply(`❌ Ошибка завершения челленджа:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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

    const ratingText = starsStr(rating);

    await editOrReply(
      ctx,
      `${ratingText} Отлично!\n\n✍️ Напиши пару слов — что заметил, что узнал?\n<i>(или пропусти)</i>`,
      [
        [Markup.button.callback("Пропустить →", `ch_fin:${id}:${rating}:nr`)],
      ],
    );
  } catch (err) {
    logger.error("challenge rate error", { error: String(err) });
    await ctx.reply(`❌ Ошибка оценки:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

async function handleSkipRate(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const id = match[1];

  try {
    await ctx.answerCbQuery();
    clearState(ctx.chat!.id);
    await completeChallenge(ctx, id, 0, null);
  } catch (err) {
    logger.error("challenge skip rate error", { error: String(err) });
    await ctx.reply(`❌ Ошибка:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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
    await ctx.reply(`❌ Ошибка:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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
    const ch = await prisma.challenge.findUnique({
      where: { id },
      select: { category: true },
    });

    await prisma.challenge.update({
      where: { id },
      data: {
        status: "completed",
        completed_at: new Date(),
        ...(rating > 0 && { rating: Math.max(1, Math.min(5, rating)) }),
        ...(reflection && { reflection }),
      },
    });

    try {
      await updateStreak();
    } catch (err) {
      logger.error("streak update failed", { error: String(err) });
    }

    const streak = await getStreak();
    const catEmoji = ch ? (CATEGORY_EMOJI[ch.category] || "🎯") : "🎯";

    // Milestone celebration (every 5 days)
    if (streak > 0 && streak % 5 === 0) {
      const fires = "🔥".repeat(Math.min(streak, 10));
      const lines = [
        "🎉🎉🎉",
        "",
        `<b>${streak} ${dayWord(streak)} подряд!</b>`,
        "Ты в ударе! Нетворкинг — это мышца,",
        "и ты её качаешь каждый день.",
        "",
        fires,
      ];
      await editOrReply(ctx, lines.join("\n"), [
        [Markup.button.callback("🏠 Меню", "main_menu")],
      ]);
      return;
    }

    // Normal celebration
    const lines: string[] = ["🎉 <b>Готово!</b>", ""];

    if (rating > 0) {
      lines.push(`${starsStr(rating)} · ${catEmoji} ${CATEGORY_LABEL[ch?.category || ""] || ""}`);
    }
    if (reflection) {
      lines.push(`📝 <i>"${esc(reflection)}"</i>`);
    }

    if (streak > 0) {
      lines.push("");
      lines.push(`🔥 Streak: ${streak} ${dayWord(streak)} подряд!`);
      lines.push("Так держать! 💪");
    }

    await editOrReply(ctx, lines.join("\n"), [
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
  } catch (err) {
    logger.error("challenge complete error", { error: String(err) });
    await ctx.reply(`❌ Ошибка сохранения:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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

    await editOrReply(ctx, "Не беда. Завтра новый день! 💙", [
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
  } catch (err) {
    logger.error("challenge skip error", { error: String(err) });
    await ctx.reply(`❌ Ошибка:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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

    // Build weekly visual with day labels
    const dayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const weekDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart.getTime() + i * 86400000);
      const dayStr = day.toISOString().slice(0, 10);
      const ch = weekChallenges.find(
        (c: { date: Date; status: string }) => c.date.toISOString().slice(0, 10) === dayStr,
      );
      weekDays.push(ch && ch.status === "completed" ? "✅" : "⬜");
    }

    // 7-day and 30-day stats
    const [stats7, stats30] = await Promise.all([
      getChallengeStats(7),
      getChallengeStats(30),
    ]);

    const lines = [
      "📊 <b>Статистика челленджей</b>",
      divider(),
      "",
      "📅 Эта неделя:",
      weekDays.join(" "),
      dayLabels.join("  "),
      "",
      thinDivider(),
      "",
      "📈 <b>Выполнение</b>",
      `7 дней:  ${progressBar(stats7.completed, stats7.total)}`,
      `30 дней: ${progressBar(stats30.completed, stats30.total)}`,
    ];

    if (streak > 0) {
      lines.push("");
      lines.push(`🔥 Streak: ${streak} ${dayWord(streak)} подряд`);
    }

    if (Object.keys(stats30.byCategory).length > 0) {
      lines.push("", thinDivider(), "", "<b>По категориям (30д):</b>");
      for (const [cat, data] of Object.entries(stats30.byCategory)) {
        const emoji = CATEGORY_EMOJI[cat] || "🎯";
        const label = (CATEGORY_LABEL[cat] || cat).padEnd(12, " ");
        const pct =
          data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
        lines.push(
          `${emoji} ${label} ${progressBar(data.completed, data.total)} (${data.completed}/${data.total})`,
        );
      }
    }

    await editOrReply(ctx, lines.join("\n"), [
      [
        Markup.button.callback("← Челлендж", "challenge"),
        Markup.button.callback("🏠 Меню", "main_menu"),
      ],
    ]);
  } catch (err) {
    logger.error("challenge stats error", { error: String(err) });
    await ctx.reply(`❌ Ошибка загрузки статистики:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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

  return { rate: total > 0 ? Math.round((completed / total) * 100) : 0, total, completed, byCategory };
}
