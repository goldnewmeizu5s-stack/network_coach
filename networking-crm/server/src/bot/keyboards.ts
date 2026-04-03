import { Markup } from "telegraf";

export const mainMenuKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback("🎤 Голосовое", "voice_info"),
    Markup.button.callback("👥 Контакты", "contacts"),
  ],
  [
    Markup.button.callback("📋 Follow-ups", "followups"),
    Markup.button.callback("🎯 Челлендж", "challenge"),
  ],
  [
    Markup.button.callback("💬 AI-чат", "ai_chat"),
    Markup.button.callback("📊 Стата", "settings_stats"),
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

  // Main menu callback (return to menu from any screen)
  bot.action("main_menu", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(MAIN_MENU_TEXT, {
      parse_mode: "HTML",
      ...mainMenuKeyboard,
    });
  });

  // contact_edit stub (not yet implemented)
  bot.action(/^contact_edit:/, (ctx) => ctx.answerCbQuery("В разработке 🚧"));

  // voice_for stub — placeholder for recording voice for specific contact
  bot.action(/^voice_for:/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      "🎤 Отправьте голосовое сообщение — оно будет привязано к этому контакту.",
      { parse_mode: "HTML" },
    );
  });
}
