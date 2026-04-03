import { Markup } from "telegraf";

export const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🎤 Голосовое", "voice_info")],
  [
    Markup.button.callback("👥 Контакты", "contacts"),
    Markup.button.callback("📋 Follow-ups", "followups"),
  ],
  [
    Markup.button.callback("🎯 Челлендж дня", "challenge"),
    Markup.button.callback("💬 AI-чат", "ai_chat"),
  ],
  [Markup.button.callback("⚙️ Настройки", "settings")],
]);

export const MAIN_MENU_TEXT =
  "<b>Главное меню</b>\n\nВыберите действие:";

export function registerCallbackHandlers(bot: import("telegraf").Telegraf) {
  bot.action("voice_info", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      "🎤 <b>Голосовые заметки</b>\n\n" +
        "Просто отправьте голосовое сообщение, кружочек или аудиофайл — " +
        "бот автоматически распознает речь и создаст контакт.",
      { parse_mode: "HTML" },
    );
  });

  const stubs = [
    "contacts",
    "followups",
    "challenge",
    "ai_chat",
    "settings",
  ] as const;

  for (const action of stubs) {
    bot.action(action, (ctx) =>
      ctx.answerCbQuery("В разработке 🚧")
    );
  }

  // Contact action stubs from voice handler results
  bot.action(/^contact_view:/, (ctx) => ctx.answerCbQuery("В разработке 🚧"));
  bot.action(/^contact_edit:/, (ctx) => ctx.answerCbQuery("В разработке 🚧"));
  bot.action(/^contact_delete:/, (ctx) => ctx.answerCbQuery("В разработке 🚧"));
}
