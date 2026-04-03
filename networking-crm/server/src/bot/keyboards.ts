import { Markup } from "telegraf";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { config } from "../config";
import { dayWord, divider, editOrReply } from "./ui";

// ── Static fallback (when DB is unavailable) ─────────────

export const mainMenuKeyboard = Markup.inlineKeyboard([
  ...(config.webappUrl
    ? [[Markup.button.webApp("\u{1F4F1} Открыть приложение", config.webappUrl)]]
    : []),
  [
    Markup.button.callback("🎤 Записать", "voice_info"),
    Markup.button.callback("👥 Контакты", "contacts"),
  ],
  [
    Markup.button.callback("📋 Follow-ups", "followups"),
    Markup.button.callback("🎯 Челлендж", "challenge"),
  ],
  [
    Markup.button.callback("💬 AI-чат", "ai_chat"),
    Markup.button.callback("⚡ Сводка", "quick_summary"),
  ],
  [Markup.button.callback("⚙️ Настройки", "settings")],
]);

export const MAIN_MENU_TEXT =
  `🏠 <b>Networking CRM</b>\n\n${divider()}\nВыбери действие:`;

// ── Dynamic main menu ────────────────────────────────────

export async function buildMainMenu(): Promise<{
  text: string;
  keyboard: ReturnType<typeof Markup.inlineKeyboard>;
}> {
  try {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const [totalContacts, pendingCount, challenge, streak] = await Promise.all([
      prisma.contact.count({ where: { warmth_status: { not: "archived" } } }),
      prisma.followUp.count({
        where: {
          OR: [
            { status: "pending" },
            { status: "snoozed", snoozed_until: { lte: now } },
          ],
        },
      }),
      prisma.challenge.findFirst({
        where: { date: { gte: todayStart, lt: todayEnd } },
        orderBy: { created_at: "asc" },
        select: { status: true },
      }),
      getStreak(),
    ]);

    // Build summary line
    const parts: string[] = [];
    parts.push(`📇 Контактов: ${totalContacts}`);
    parts.push(`📋 Follow-ups: ${pendingCount}`);
    if (streak > 0) parts.push(`🔥 ${streak} ${dayWord(streak)}`);

    const summaryLine = parts.join(" | ");

    const text = [
      "🏠 <b>Networking CRM</b>",
      "",
      summaryLine,
      divider(),
      "Выбери действие:",
    ].join("\n");

    // Dynamic button labels
    const fuLabel = pendingCount > 0
      ? `📋 Follow-ups (${pendingCount})`
      : "📋 Follow-ups";

    const challengeLabel = challenge?.status === "completed"
      ? "🎯 Челлендж ✅"
      : "🎯 Челлендж";

    const keyboard = Markup.inlineKeyboard([
      ...(config.webappUrl
        ? [[Markup.button.webApp("\u{1F4F1} Открыть приложение", config.webappUrl)]]
        : []),
      [
        Markup.button.callback("🎤 Записать", "voice_info"),
        Markup.button.callback("👥 Контакты", "contacts"),
      ],
      [
        Markup.button.callback(fuLabel, "followups"),
        Markup.button.callback(challengeLabel, "challenge"),
      ],
      [
        Markup.button.callback("💬 AI-чат", "ai_chat"),
        Markup.button.callback("⚡ Сводка", "quick_summary"),
      ],
      [Markup.button.callback("⚙️ Настройки", "settings")],
    ]);

    return { text, keyboard };
  } catch (err) {
    logger.error("buildMainMenu error, using fallback", { error: String(err) });
    return { text: MAIN_MENU_TEXT, keyboard: mainMenuKeyboard };
  }
}

// ── Streak helper (reused in commands.ts too) ────────────

export async function getStreak(): Promise<number> {
  const yearAgo = new Date(Date.now() - 365 * 86400000);
  const completed = await prisma.challenge.findMany({
    where: { status: "completed", date: { gte: yearAgo } },
    select: { date: true },
  });
  const completedDays = new Set(
    completed.map((c: { date: Date }) => c.date.toISOString().slice(0, 10)),
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

// ── Callback handlers ────────────────────────────────────

export function registerCallbackHandlers(bot: import("telegraf").Telegraf) {
  bot.action("voice_info", async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        "🎤 <b>Голосовые заметки</b>\n\n" +
          "Просто отправьте голосовое сообщение, кружочек или аудиофайл — " +
          "бот автоматически распознает речь и создаст контакт.",
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🏠 Меню", "main_menu")],
          ]),
        },
      );
    } catch (err) {
      logger.error("voice_info callback error", { error: String(err) });
    }
  });

  // Main menu callback (return to menu from any screen)
  bot.action("main_menu", async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const { text, keyboard } = await buildMainMenu();
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        ...keyboard,
      });
    } catch (err) {
      logger.error("main_menu callback error", { error: String(err) });
    }
  });

  // Quick summary callback (from menu button)
  bot.action("quick_summary", async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const { quickSummary } = await import("./commands");
      await quickSummary(ctx);
    } catch (err) {
      logger.error("quick_summary callback error", { error: String(err) });
    }
  });

  // contact_edit stub (not yet implemented)
  bot.action(/^contact_edit:/, async (ctx) => {
    try {
      await ctx.answerCbQuery("В разработке 🚧");
    } catch (err) {
      logger.error("contact_edit callback error", { error: String(err) });
    }
  });

  // voice_for stub — placeholder for recording voice for specific contact
  bot.action(/^voice_for:/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const match = (ctx as any).match as RegExpMatchArray;
      const contactId = match ? match[0].replace("voice_for:", "") : "";
      const backButton = contactId
        ? Markup.button.callback("← К контакту", `contact_view:${contactId}`)
        : Markup.button.callback("🏠 Меню", "main_menu");
      await ctx.reply(
        "🎤 Отправьте голосовое сообщение — оно будет привязано к этому контакту.",
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[backButton]]),
        },
      );
    } catch (err) {
      logger.error("voice_for callback error", { error: String(err) });
    }
  });
}
