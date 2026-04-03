import { Telegraf } from "telegraf";
import { config } from "../config";
import { logger } from "../lib/logger";
import { adminOnly, logMessage } from "./middleware";
import { registerCommands } from "./commands";
import { registerCallbackHandlers } from "./keyboards";
import { registerVoiceHandlers } from "./handlers/voice";
import { registerContactHandlers, registerTextHandler } from "./handlers/contacts";
import { registerFollowupHandlers } from "./handlers/followups";
import { registerChallengeHandlers } from "./handlers/challenges";
import { registerChatHandlers } from "./handlers/chat";

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
  registerVoiceHandlers(bot);

  // Text handler must be last (catch-all for notes & search)
  registerTextHandler(bot);

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
