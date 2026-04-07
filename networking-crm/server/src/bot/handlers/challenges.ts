import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  generateDailyChallenge,
  generateAlternativeChallenges,
  generateBonusChallenge,
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
  calculateXp,
  getRankInfo,
  rankBadge,
  xpProgressBar,
  difficultyLabel,
  timeBadge,
  categoryAccent,
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
  // New feature handlers
  bot.action("challenge_bonus", handleBonus);
  bot.action("challenge_history", handleHistory);
  bot.action(/^challenge_hist_day:(-?\d+)$/, handleHistoryDay);
  bot.action(/^challenge_pref:(easier|harder)$/, handleDifficultyPref);
  bot.action(/^challenge_share:(.+)$/, handleShare);
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

async function getTotalXp(): Promise<number> {
  const result = await prisma.challenge.aggregate({
    _sum: { xp_earned: true },
    where: { status: "completed" },
  });
  return result._sum.xp_earned || 0;
}

async function getDifficultyPref(): Promise<string | null> {
  const user = await prisma.user.findFirst();
  if (!user) return null;
  const prefs = (user.preferences as Record<string, unknown>) || {};
  return (prefs.difficulty_pref as string) || null;
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
  estimated_time_minutes?: number | null;
  xp_earned?: number;
  is_bonus?: boolean;
  methodology?: { title: string; source: string } | null;
}

function renderChallengeCard(ch: ChallengeWithMethod, streak: number, rankInfo: ReturnType<typeof getRankInfo>): string {
  const catEmoji = CATEGORY_EMOJI[ch.category] || "🎯";
  const catLabel = CATEGORY_LABEL[ch.category] || ch.category;
  const accent = categoryAccent(ch.category);
  const bonusTag = ch.is_bonus ? " ⭐ БОНУС" : "";

  // ─── Completed state ───
  if (ch.status === "completed" && ch.rating) {
    const xp = ch.xp_earned || 0;
    const lines = [
      `✅ <b>Челлендж выполнен!</b>${bonusTag}`,
      divider(),
      "",
      `${catEmoji} <b>${esc(ch.title)}</b>`,
      `${starsStr(ch.rating)}  ·  +${xp} XP`,
    ];
    if (ch.reflection) {
      lines.push("", `💭 <i>"${esc(ch.reflection)}"</i>`);
    }
    lines.push("", thinDivider());
    if (streak > 0) {
      lines.push(`🔥 ${streak} ${dayWord(streak)} подряд  ·  ${rankBadge(rankInfo)}`);
    }
    return lines.join("\n");
  }

  // ─── Accepted state ───
  const lines: string[] = [];
  if (ch.status === "accepted") {
    lines.push("🚀 <b>Челлендж принят! Вперёд!</b>", "");
  }

  // ─── Header ───
  const headerEmoji = ch.is_bonus ? "⭐" : "🎯";
  const headerTitle = ch.is_bonus ? "Бонус-челлендж" : "Челлендж дня";
  lines.push(`${headerEmoji} <b>${headerTitle}</b>`);
  lines.push(divider());
  lines.push("");

  // ─── Category + Difficulty row ───
  const diffLabel = difficultyLabel(ch.difficulty);
  lines.push(`${catEmoji} <b>${esc(ch.title)}</b>`);
  lines.push("");

  // ─── Info badges row ───
  const badges: string[] = [];
  badges.push(`📂 ${catLabel}`);
  badges.push(`${difficultyBar(ch.difficulty)} ${ch.difficulty}/10 · ${diffLabel}`);
  if (ch.estimated_time_minutes) {
    badges.push(timeBadge(ch.estimated_time_minutes));
  }
  const potentialXp = calculateXp(ch.difficulty, false);
  badges.push(`🏆 +${potentialXp}-${potentialXp + 15} XP`);
  lines.push(badges.join("\n"));

  lines.push("");
  lines.push(esc(ch.description));

  if (ch.methodology) {
    lines.push(
      "",
      `📚 <i>Метод: ${esc(ch.methodology.title)} (${esc(ch.methodology.source)})</i>`,
    );
  }

  lines.push("", thinDivider());

  // ─── Footer: streak + rank ───
  const footerParts: string[] = [];
  if (streak > 0) {
    footerParts.push(`🔥 ${streak} ${dayWord(streak)}`);
  }
  footerParts.push(rankBadge(rankInfo));
  lines.push(footerParts.join("  ·  "));
  lines.push(xpProgressBar(rankInfo));

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
        [
          Markup.button.callback("📉 Полегче", "challenge_pref:easier"),
          Markup.button.callback("📈 Потруднее", "challenge_pref:harder"),
        ],
        [Markup.button.callback("😰 Слишком сложно", `challenge_too_hard:${ch.id}`)],
        [
          Markup.button.callback("⭐ Бонус", "challenge_bonus"),
          Markup.button.callback("📅 История", "challenge_history"),
        ],
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
        [Markup.button.callback("📤 Поделиться", `challenge_share:${ch.id}`)],
        [
          Markup.button.callback("⭐ Бонус", "challenge_bonus"),
          Markup.button.callback("📅 История", "challenge_history"),
        ],
        [
          Markup.button.callback("📊 Статистика", "challenge_stats"),
          Markup.button.callback("🏠 Меню", "main_menu"),
        ],
      ];
    default:
      // skipped / too_hard
      return [
        [Markup.button.callback("🔄 Другой челлендж", "challenge_another")],
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
      where: { date: { gte: start, lt: end }, is_bonus: false },
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

    const [streak, totalXp] = await Promise.all([getStreak(), getTotalXp()]);
    const rankInfo = getRankInfo(totalXp);
    const text = renderChallengeCard(main, streak, rankInfo);

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
    await ctx.answerCbQuery("🚀 Принято!");

    await prisma.challenge.update({
      where: { id },
      data: { status: "accepted" },
    });

    const ch = await prisma.challenge.findUnique({
      where: { id },
      include: { methodology: { select: { title: true, source: true } } },
    });
    if (!ch) return;

    const [streak, totalXp] = await Promise.all([getStreak(), getTotalXp()]);
    const rankInfo = getRankInfo(totalXp);
    const text = renderChallengeCard(ch, streak, rankInfo);
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
      where: { date: { gte: start, lt: end }, status: "pending", is_bonus: false },
      include: { methodology: { select: { title: true, source: true } } },
      orderBy: { created_at: "asc" },
    });

    const pendingAlts = challenges.slice(1);
    const alt = pendingAlts[0];

    if (!alt) {
      await ctx.reply("Это последний вариант на сегодня 🤷", {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🏠 Меню", "main_menu")],
        ]),
      });
      return;
    }

    const [streak, totalXp] = await Promise.all([getStreak(), getTotalXp()]);
    const rankInfo = getRankInfo(totalXp);
    const text = renderChallengeCard(alt, streak, rankInfo);
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

    await editOrReply(ctx, "Понял, подберу полегче 💙\nСложность будет снижена завтра.", [
      [Markup.button.callback("🔄 Попробовать другой", "challenge_another")],
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

    const text = "🎉 <b>Отлично! Как прошло?</b>\n\nОцени свой опыт:";

    const buttons = [
      [
        Markup.button.callback("😕 1", `challenge_rate:${id}:1`),
        Markup.button.callback("🙂 2", `challenge_rate:${id}:2`),
        Markup.button.callback("👍 3", `challenge_rate:${id}:3`),
        Markup.button.callback("🔥 4", `challenge_rate:${id}:4`),
        Markup.button.callback("🤩 5", `challenge_rate:${id}:5`),
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
      `${ratingText}\n\n✍️ Напиши пару слов — что заметил, что узнал?\n<i>Рефлексия даёт +15 XP бонус!</i>`,
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
      select: { category: true, difficulty: true },
    });

    const xp = calculateXp(ch?.difficulty || 5, !!reflection);

    await prisma.challenge.update({
      where: { id },
      data: {
        status: "completed",
        completed_at: new Date(),
        xp_earned: xp,
        ...(rating > 0 && { rating: Math.max(1, Math.min(5, rating)) }),
        ...(reflection && { reflection }),
      },
    });

    try {
      await updateStreak();
    } catch (err) {
      logger.error("streak update failed", { error: String(err) });
    }

    const [streak, totalXp] = await Promise.all([getStreak(), getTotalXp()]);
    const rankInfo = getRankInfo(totalXp);
    const prevRankInfo = getRankInfo(totalXp - xp);
    const catEmoji = ch ? (CATEGORY_EMOJI[ch.category] || "🎯") : "🎯";
    const leveledUp = rankInfo.level > prevRankInfo.level;

    // Milestone celebration (every 5 days)
    if (streak > 0 && streak % 5 === 0) {
      const fires = "🔥".repeat(Math.min(streak / 5, 6));
      const lines = [
        "🎉🎉🎉",
        "",
        `<b>${streak} ${dayWord(streak)} подряд!</b>`,
        fires,
        "",
        "Ты в ударе! Нетворкинг — это мышца,",
        "и ты её качаешь каждый день.",
        "",
        `+${xp} XP  ·  ${rankBadge(rankInfo)}`,
        xpProgressBar(rankInfo),
      ];
      await editOrReply(ctx, lines.join("\n"), [
        [Markup.button.callback("📤 Поделиться", `challenge_share:${id}`)],
        [Markup.button.callback("🏠 Меню", "main_menu")],
      ]);
      return;
    }

    // Level up celebration
    if (leveledUp) {
      const lines = [
        "🏆🏆🏆",
        "",
        `<b>Новый уровень!</b>`,
        "",
        `${prevRankInfo.emoji} ${prevRankInfo.rank}  →  ${rankInfo.emoji} <b>${rankInfo.rank}</b>`,
        "",
        `+${xp} XP  ·  Всего: ${totalXp} XP`,
        xpProgressBar(rankInfo),
        "",
        "Продолжай в том же духе! 🚀",
      ];
      await editOrReply(ctx, lines.join("\n"), [
        [Markup.button.callback("📤 Поделиться", `challenge_share:${id}`)],
        [Markup.button.callback("🏠 Меню", "main_menu")],
      ]);
      return;
    }

    // Normal celebration
    const lines: string[] = [
      "🎉 <b>Готово!</b>",
      "",
      `${catEmoji} +${xp} XP`,
    ];

    if (rating > 0) {
      lines.push(starsStr(rating));
    }
    if (reflection) {
      lines.push(`💭 <i>"${esc(reflection)}"</i>`);
    }

    lines.push("");
    lines.push(`${rankBadge(rankInfo)}`);
    lines.push(xpProgressBar(rankInfo));

    if (streak > 0) {
      lines.push("");
      lines.push(`🔥 ${streak} ${dayWord(streak)} подряд — так держать! 💪`);
    }

    await editOrReply(ctx, lines.join("\n"), [
      [Markup.button.callback("📤 Поделиться", `challenge_share:${id}`)],
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

    await editOrReply(ctx, "Не беда — завтра новый шанс! 💙", [
      [Markup.button.callback("🔄 Другой челлендж", "challenge_another")],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
  } catch (err) {
    logger.error("challenge skip error", { error: String(err) });
    await ctx.reply(`❌ Ошибка:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

// ── Stats ─────────────────────────────────────────────────

async function handleStats(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const [streak, totalXp] = await Promise.all([getStreak(), getTotalXp()]);
    const rankInfo = getRankInfo(totalXp);

    // Weekly data
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekChallenges = await prisma.challenge.findMany({
      where: { date: { gte: weekStart } },
      select: { date: true, status: true },
    });

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

    const [stats7, stats30] = await Promise.all([
      getChallengeStats(7),
      getChallengeStats(30),
    ]);

    const lines = [
      "📊 <b>Статистика челленджей</b>",
      divider(),
      "",
      `${rankBadge(rankInfo)}`,
      xpProgressBar(rankInfo),
      "",
      thinDivider(),
      "",
      "📅 <b>Эта неделя:</b>",
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
      lines.push(`🔥 Streak: <b>${streak}</b> ${dayWord(streak)} подряд`);
    }

    lines.push("");
    lines.push(`🏆 Всего XP: <b>${totalXp}</b>`);
    lines.push(`✅ Выполнено: <b>${stats30.completed}</b> за 30 дней`);

    if (Object.keys(stats30.byCategory).length > 0) {
      lines.push("", thinDivider(), "", "<b>По категориям (30д):</b>");
      for (const [cat, data] of Object.entries(stats30.byCategory)) {
        const emoji = CATEGORY_EMOJI[cat] || "🎯";
        const label = (CATEGORY_LABEL[cat] || cat).padEnd(12, " ");
        lines.push(
          `${emoji} ${label} ${progressBar(data.completed, data.total)} (${data.completed}/${data.total})`,
        );
      }
    }

    await editOrReply(ctx, lines.join("\n"), [
      [
        Markup.button.callback("← Челлендж", "challenge"),
        Markup.button.callback("📅 История", "challenge_history"),
      ],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
  } catch (err) {
    logger.error("challenge stats error", { error: String(err) });
    await ctx.reply(`❌ Ошибка загрузки статистики:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

// ── New Features ──────────────────────────────────────────

async function handleBonus(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const { start, end } = todayRange();
    // Check if bonus already exists today
    let bonus = await prisma.challenge.findFirst({
      where: { date: { gte: start, lt: end }, is_bonus: true },
      include: { methodology: { select: { title: true, source: true } } },
    });

    if (!bonus) {
      const created = await generateBonusChallenge();
      bonus = await prisma.challenge.findFirst({
        where: { id: created.id },
        include: { methodology: { select: { title: true, source: true } } },
      });
    }

    if (!bonus) {
      await ctx.reply("❌ Не удалось создать бонус-челлендж.");
      return;
    }

    const [streak, totalXp] = await Promise.all([getStreak(), getTotalXp()]);
    const rankInfo = getRankInfo(totalXp);
    const text = renderChallengeCard(bonus, streak, rankInfo);
    await editOrReply(ctx, text, challengeButtons(bonus));
  } catch (err) {
    logger.error("bonus challenge error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleHistory(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const days = 7;
    const since = new Date(Date.now() - days * 86400000);
    since.setHours(0, 0, 0, 0);

    const challenges = await prisma.challenge.findMany({
      where: { date: { gte: since }, is_bonus: false },
      orderBy: { date: "desc" },
      select: { date: true, title: true, category: true, status: true, difficulty: true, xp_earned: true },
    });

    const lines = [
      "📅 <b>История челленджей</b>",
      divider(),
      "",
    ];

    // Group by day
    const byDay = new Map<string, typeof challenges>();
    for (const ch of challenges) {
      const key = ch.date.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(ch);
    }

    const dayNames = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
    let dayIndex = 0;
    for (const [dateStr, dayChallenges] of byDay) {
      const d = new Date(dateStr);
      const dayName = dayNames[d.getDay()];
      const dateFormatted = `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
      const main = dayChallenges[0];
      const statusIcon = main.status === "completed" ? "✅"
        : main.status === "accepted" ? "💪"
        : main.status === "skipped" ? "⏭"
        : main.status === "too_hard" ? "😰"
        : "⬜";
      const catEmoji = CATEGORY_EMOJI[main.category] || "🎯";
      const xp = main.xp_earned ? `+${main.xp_earned}XP` : "";

      lines.push(`${statusIcon} <b>${dayName} ${dateFormatted}</b> ${catEmoji} ${esc(main.title)} ${xp}`);
      dayIndex++;
    }

    if (challenges.length === 0) {
      lines.push("<i>Пока нет истории</i>");
    }

    await editOrReply(ctx, lines.join("\n"), [
      [
        Markup.button.callback("← Челлендж", "challenge"),
        Markup.button.callback("📊 Статистика", "challenge_stats"),
      ],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
  } catch (err) {
    logger.error("challenge history error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка загрузки");
  }
}

async function handleHistoryDay(ctx: Context) {
  // Reserved for future day-detail navigation
  await safeAnswer(ctx, "Скоро будет доступно");
}

async function handleDifficultyPref(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const direction = match[1]; // "easier" or "harder"

  try {
    await ctx.answerCbQuery();

    const user = await prisma.user.findFirst();
    if (!user) return;

    const prefs = (user.preferences as Record<string, unknown>) || {};
    const currentAdj = (prefs.difficulty_adjustment as number) || 0;
    const newAdj = direction === "easier"
      ? Math.max(-3, currentAdj - 1)
      : Math.min(3, currentAdj + 1);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        preferences: {
          ...prefs,
          difficulty_adjustment: newAdj,
          difficulty_pref: direction,
        },
      },
    });

    const emoji = direction === "easier" ? "📉" : "📈";
    const label = direction === "easier" ? "Снижаю сложность" : "Повышаю сложность";
    await editOrReply(ctx, `${emoji} <b>${label}!</b>\n\nНовые челленджи будут адаптированы.`, [
      [Markup.button.callback("← К челленджу", "challenge")],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
  } catch (err) {
    logger.error("difficulty pref error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleShare(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const id = match[1];

  try {
    await ctx.answerCbQuery();

    const ch = await prisma.challenge.findUnique({
      where: { id },
      select: { title: true, category: true, difficulty: true, xp_earned: true, rating: true },
    });
    if (!ch) return;

    const [streak, totalXp] = await Promise.all([getStreak(), getTotalXp()]);
    const rankInfo = getRankInfo(totalXp);
    const catEmoji = CATEGORY_EMOJI[ch.category] || "🎯";

    const shareText = [
      "━━━━━━━━━━━━━━━",
      `${catEmoji} <b>Челлендж выполнен!</b>`,
      "",
      `📌 ${esc(ch.title)}`,
      `${ch.rating ? starsStr(ch.rating) : ""}  ·  +${ch.xp_earned || 0} XP`,
      "",
      `🔥 Streak: ${streak} ${dayWord(streak)}`,
      `${rankBadge(rankInfo)}`,
      "",
      "🤖 Network Coach Bot",
      "━━━━━━━━━━━━━━━",
    ].filter(Boolean).join("\n");

    // Send as a new message (not edit) so user can forward it
    await ctx.reply(shareText, { parse_mode: "HTML" });
  } catch (err) {
    logger.error("challenge share error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

// ── Helpers ───────────────────────────────────────────────

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
