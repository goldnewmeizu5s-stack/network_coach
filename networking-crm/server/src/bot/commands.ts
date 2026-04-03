import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { config } from "../config";
import { buildMainMenu, mainMenuKeyboard, getStreak } from "./keyboards";
import { clearState } from "./state";
import {
  esc,
  dayWord,
  divider,
  thinDivider,
  starsStr,
  editOrReply,
  STATUS_EMOJI,
} from "./ui";

export function registerCommands(bot: Telegraf) {
  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("menu", handleMenu);
  bot.command("quick", handleQuick);
}

// ── /start ───────────────────────────────────────────────

async function handleStart(ctx: Context) {
  try {
    const totalContacts = await prisma.contact
      .count({ where: { warmth_status: { not: "archived" } } })
      .catch(() => 0);

    const intro = [
      "🤝 <b>Привет! Я — твой нетворкинг-ассистент.</b>",
      "",
      "Я помогу тебе:",
      "📇 Записывать знакомства голосом",
      "🔔 Не забывать про follow-ups",
      "🎯 Расти через ежедневные челленджи",
      "🤖 Получать AI-советы по нетворкингу",
      "",
      "Просто отправь мне голосовое 🎤",
      "о человеке, которого встретил — и я сделаю остальное.",
      "",
      "💡 Напиши имя контакта для быстрого поиска",
    ];

    if (totalContacts === 0) {
      intro.push("");
      intro.push(
        "✨ <i>Начни с голосового: расскажи о ком-то,\nкого недавно встретил, и я создам контакт.</i>",
      );
    }

    intro.push(divider());

    const { text: menuText, keyboard } = await buildMainMenu();

    // Append menu text after intro
    await ctx.reply(intro.join("\n") + "\n" + menuText, {
      parse_mode: "HTML",
      ...keyboard,
    });
  } catch (err) {
    logger.error("start command error", { error: String(err) });
    await ctx.reply("🤝 Привет! Я — твой нетворкинг-ассистент.\n\nОтправь /menu для начала.", {
      parse_mode: "HTML",
      ...mainMenuKeyboard,
    });
  }
}

// ── /help ────────────────────────────────────────────────

async function handleHelp(ctx: Context) {
  const text = [
    "📖 <b>Справка</b>",
    divider(),
    "",
    "<b>🎤 Голосовые</b>",
    "Отправь голосовое, кружочек или аудио —",
    "я распознаю речь и создам контакт.",
    "",
    "<b>🔍 Быстрый поиск</b>",
    "Просто напиши имя — я найду контакт.",
    "",
    "<b>💬 AI-чат</b>",
    "Нажми «AI-чат» в меню и спрашивай",
    "что угодно о своём нетворкинге.",
    "",
    thinDivider(),
    "",
    "<b>Команды:</b>",
    "/menu — главное меню",
    "/quick — быстрая сводка",
    "/help — эта справка",
  ].join("\n");

  await ctx.reply(text, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Меню", "main_menu")]]),
  });
}

// ── /menu ────────────────────────────────────────────────

async function handleMenu(ctx: Context) {
  clearState(ctx.chat!.id);
  try {
    const { text, keyboard } = await buildMainMenu();
    await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
  } catch (err) {
    logger.error("menu command error", { error: String(err) });
    await ctx.reply("🏠 <b>Networking CRM</b>\n\nВыбери действие:", {
      parse_mode: "HTML",
      ...mainMenuKeyboard,
    });
  }
}

// ── /quick (also used as callback from menu) ─────────────

async function handleQuick(ctx: Context) {
  await quickSummary(ctx);
}

export async function quickSummary(ctx: Context) {
  try {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const [
      pendingCount,
      overdueCount,
      challenge,
      totalContacts,
      byStatus,
      urgent,
      streak,
    ] = await Promise.all([
      prisma.followUp.count({
        where: {
          OR: [
            { status: "pending" },
            { status: "snoozed", snoozed_until: { lte: now } },
          ],
        },
      }),
      prisma.followUp.count({
        where: { status: "pending", due_date: { lt: todayStart } },
      }),
      prisma.challenge.findFirst({
        where: { date: { gte: todayStart, lt: todayEnd } },
        orderBy: { created_at: "asc" },
        select: { title: true, status: true, rating: true },
      }),
      prisma.contact.count({ where: { warmth_status: { not: "archived" } } }),
      prisma.contact.groupBy({
        by: ["warmth_status"],
        _count: true,
        where: { warmth_status: { not: "archived" } },
      }),
      prisma.contact.findFirst({
        where: {
          warmth_status: { notIn: ["archived", "paused"] },
          last_interaction_at: { lt: new Date(Date.now() - 14 * 86400000) },
        },
        orderBy: { last_interaction_at: { sort: "asc", nulls: "first" } },
        select: { full_name: true, last_interaction_at: true },
      }),
      getStreak(),
    ]);

    const lines: string[] = [
      "⚡ <b>Быстрая сводка</b>",
      divider(),
      "",
    ];

    // Follow-ups
    const overdueStr = overdueCount > 0 ? ` (${overdueCount} просрочен)` : "";
    lines.push(`📋 Follow-ups: <b>${pendingCount}</b> активных${overdueStr}`);

    // Challenge
    if (challenge) {
      const title = esc(challenge.title);
      if (challenge.status === "completed") {
        const stars = challenge.rating ? ` ${starsStr(challenge.rating)}` : "";
        lines.push(`🎯 Челлендж: ${title}`);
        lines.push(`   ✅ выполнен${stars}`);
      } else if (challenge.status === "accepted") {
        lines.push(`🎯 Челлендж: ${title}`);
        lines.push("   в процессе 💪");
      } else if (challenge.status === "skipped") {
        lines.push(`🎯 Челлендж: ${title}`);
        lines.push("   ⏭ пропущен");
      } else {
        lines.push(`🎯 Челлендж: ${title}`);
        lines.push("   ░░░░░░░░░░ ещё не принят");
      }
    }

    // Streak
    if (streak > 0) {
      lines.push(`🔥 Streak: <b>${streak}</b> ${dayWord(streak)} подряд`);
    }

    // Contacts breakdown
    const statusMap: Record<string, number> = {};
    for (const row of byStatus) {
      statusMap[row.warmth_status] = row._count;
    }

    lines.push("");
    lines.push(thinDivider());
    lines.push("");
    lines.push(`👥 Контакты: ${totalContacts}`);

    const statusParts: string[] = [];
    for (const s of ["new", "warming", "warm", "cooling", "paused"]) {
      const count = statusMap[s] || 0;
      if (count > 0) statusParts.push(`${STATUS_EMOJI[s]} ${count}`);
    }
    if (statusParts.length > 0) {
      lines.push(`   ${statusParts.join("  ")}`);
    }

    // Urgent/neglected contact
    if (urgent) {
      const days = urgent.last_interaction_at
        ? Math.floor((Date.now() - urgent.last_interaction_at.getTime()) / 86400000)
        : 999;
      lines.push("");
      lines.push(thinDivider());
      lines.push("");
      lines.push(
        `💡 Напиши <b>${esc(urgent.full_name)}</b> — ${days} ${dayWord(days)} без контакта`,
      );
    }

    const buttons = [
      [
        Markup.button.callback("📋 Follow-ups", "followups"),
        Markup.button.callback("🎯 Челлендж", "challenge"),
      ],
      [
        Markup.button.callback("👥 Контакты", "contacts"),
        Markup.button.callback("💬 AI-чат", "ai_chat"),
      ],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ];

    await editOrReply(ctx, lines.join("\n"), buttons);
  } catch (err) {
    logger.error("quick summary error", { error: String(err) });
    await ctx.reply("❌ Ошибка загрузки сводки.", { parse_mode: "HTML" });
  }
}
