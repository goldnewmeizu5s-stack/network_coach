import { Telegraf } from "telegraf";
import { mainMenuKeyboard, MAIN_MENU_TEXT } from "./keyboards";

const HELP_TEXT = `<b>Доступные команды:</b>

/start — запуск бота и главное меню
/menu — показать главное меню
/help — справка по командам

<b>Возможности:</b>
• Отправьте голосовое сообщение — бот его обработает
• Управляйте контактами и follow-ups
• Получайте челлендж дня
• Общайтесь с AI-ассистентом`;

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

  bot.command("menu", (ctx) =>
    ctx.reply(MAIN_MENU_TEXT, { parse_mode: "HTML", ...mainMenuKeyboard })
  );
}
