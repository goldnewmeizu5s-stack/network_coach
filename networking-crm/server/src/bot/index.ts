import { Telegraf } from "telegraf";
import { config } from "../config";
import { logger } from "../lib/logger";
import { adminOnly, logMessage } from "./middleware";
import { registerCommands } from "./commands";
import { registerCallbackHandlers } from "./keyboards";
import { registerVoiceHandlers } from "./handlers/voice";

let bot: Telegraf | null = null;

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
  registerVoiceHandlers(bot);

  // Catch errors — never crash the server
  bot.catch((err) => {
    logger.error("Telegram bot error", { error: String(err) });
  });

  bot.launch();
  logger.info("Telegram bot started (long polling)");
}

export function stopBot(): void {
  if (bot) {
    bot.stop("Server shutdown");
    logger.info("Telegram bot stopped");
  }
}
