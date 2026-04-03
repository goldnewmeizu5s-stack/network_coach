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
  const stubs = [
    "voice_info",
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
}
