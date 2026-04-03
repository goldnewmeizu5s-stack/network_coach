import { Telegraf, Markup } from "telegraf";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { mainMenuKeyboard, MAIN_MENU_TEXT } from "./keyboards";
import { clearState } from "./state";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dayWord(n: number): string {
  const abs = Math.abs(n);
  if (abs % 10 === 1 && abs % 100 !== 11) return "день";
  if (abs % 10 >= 2 && abs % 10 <= 4 && (abs % 100 < 10 || abs % 100 >= 20))
    return "дня";
  return "дней";
}

const HELP_TEXT = `<b>Доступные команды:</b>

/start — запуск бота и главное меню
/menu — показать главное меню
/quick — быстрая сводка
/help — справка по командам

<b>Возможности:</b>
• Отправьте голосовое сообщение — бот его обработает
• Управляйте контактами и follow-ups
• Получайте челлендж дня
• Общайтесь с AI-ассистентом
• Напишите имя контакта для быстрого поиска`;

export function registerCommands(bot: Telegraf) {
  bot.command("start", (ctx) =>
    ctx.reply(
      `Привет! Я — твой нетворкинг-ассистент.\n\n${MAIN_MENU_TEXT}`,
      { parse_mode: "HTML", ...mainMenuKeyboard },
    )
  );

  bot.command("help", (ctx) =>
    ctx.reply(HELP_TEXT, { parse_mode: "HTML" })
  );

  bot.command("menu", (ctx) => {
    clearState(ctx.chat.id);
    return ctx.reply(MAIN_MENU_TEXT, {
      parse_mode: "HTML",
      ...mainMenuKeyboard,
    });
  });

  bot.command("quick", async (ctx) => {
    try {
      const now = new Date();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart.getTime() + 86400000);

      const [pendingCount, overdueCount, challenge, urgent] = await Promise.all([
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
          select: { title: true, status: true },
        }),
        prisma.contact.findFirst({
          where: {
            warmth_status: { notIn: ["archived", "paused"] },
            last_interaction_at: {
              lt: new Date(Date.now() - 14 * 86400000),
            },
          },
          orderBy: { last_interaction_at: { sort: "asc", nulls: "first" } },
          select: { full_name: true },
        }),
      ]);

      // Streak
      const yearAgo = new Date(Date.now() - 365 * 86400000);
      const completed = await prisma.challenge.findMany({
        where: { status: "completed", date: { gte: yearAgo } },
        select: { date: true },
      });
      const completedDays = new Set(
        completed.map((c: { date: Date }) => c.date.toISOString().slice(0, 10)),
      );
      let streak = 0;
      const streakNow = new Date();
      streakNow.setHours(0, 0, 0, 0);
      for (let i = 0; i < 365; i++) {
        const day = new Date(streakNow.getTime() - i * 86400000);
        if (completedDays.has(day.toISOString().slice(0, 10))) {
          streak++;
        } else {
          break;
        }
      }

      const overdueStr =
        overdueCount > 0 ? ` (${overdueCount} просрочен)` : "";

      const statusEmoji: Record<string, string> = {
        pending: "",
        accepted: "💪 принят",
        completed: "✅ выполнен",
        skipped: "⏭ пропущен",
        too_hard: "😰",
      };

      const lines = ["⚡ <b>Быстрая сводка</b>", ""];
      lines.push(`📋 ${pendingCount} follow-ups${overdueStr}`);

      if (challenge) {
        const st = statusEmoji[challenge.status] || "";
        lines.push(
          `🎯 Челлендж: ${escapeHtml(challenge.title)}${st ? ` (${st})` : ""}`,
        );
      }

      lines.push(`🔥 Streak: ${streak} ${dayWord(streak)}`);

      if (urgent) {
        lines.push(
          `💡 Напиши ${escapeHtml(urgent.full_name)} — давно не общались!`,
        );
      }

      await ctx.reply(lines.join("\n"), {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("📋 Follow-ups", "followups"),
            Markup.button.callback("🎯 Челлендж", "challenge"),
          ],
          [Markup.button.callback("🏠 Меню", "main_menu")],
        ]),
      });
    } catch (err) {
      logger.error("quick command error", { error: String(err) });
      await ctx.reply("❌ Ошибка загрузки.");
    }
  });
}
