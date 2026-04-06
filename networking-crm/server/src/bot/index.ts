import { Telegraf } from "telegraf";
import { config } from "../config";
import { logger } from "../lib/logger";
import { fmtError } from "./ui";
import { adminOnly, logMessage } from "./middleware";
import { registerCommands } from "./commands";
import { registerCallbackHandlers } from "./keyboards";
import { registerVoiceHandlers } from "./handlers/voice";
import { registerContactHandlers, registerTextHandler } from "./handlers/contacts";
import { registerFollowupHandlers } from "./handlers/followups";
import { registerChallengeHandlers } from "./handlers/challenges";
import { registerChatHandlers } from "./handlers/chat";
import { registerSettingsHandlers } from "./handlers/settings";

let bot: Telegraf | null = null;

/** Get the bot instance for sending notifications */
export function getBotInstance(): Telegraf | null {
  return bot;
}

export function startBot(): void {
  if (!config.telegramBotToken) {
    logger.info("Telegram bot: no token, skipping");
    return;
  }

  bot = new Telegraf(config.telegramBotToken);

  // Middleware
  bot.use(adminOnly);
  bot.use(logMessage);

  // Commands, callbacks & handlers
  registerCommands(bot);
  registerCallbackHandlers(bot);
  registerContactHandlers(bot);
  registerFollowupHandlers(bot);
  registerChallengeHandlers(bot);
  registerChatHandlers(bot);
  registerSettingsHandlers(bot);
  registerVoiceHandlers(bot);

  // Text handler must be last (catch-all for notes & search)
  registerTextHandler(bot);

  // Catch errors — never crash the server, send error to admin chat
  bot.catch((err: unknown, ctx) => {
    logger.error("Telegram bot error", { error: String(err) });
    // Try to notify the user about the error
    if (ctx?.chat?.id) {
      ctx.reply(`⚠️ Необработанная ошибка бота:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" }).catch(() => {});
    }
  });

  bot.launch();
  logger.info("Telegram bot started (long polling)");

  // Set Menu Button for Mini App
  if (config.webappUrl) {
    bot.telegram.setChatMenuButton({
      menuButton: {
        type: "web_app",
        text: "\u{1F4F1} CRM",
        web_app: { url: config.webappUrl },
      },
    }).catch((err) => {
      logger.warn("Failed to set menu button", { error: String(err) });
    });
  }
}

export function stopBot(): void {
  if (bot) {
    bot.stop("Server shutdown");
    logger.info("Telegram bot stopped");
  }
}
