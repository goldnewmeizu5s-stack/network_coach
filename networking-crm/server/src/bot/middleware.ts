import { Context } from "telegraf";
import { config } from "../config";
import { logger } from "../lib/logger";

let dynamicAdminChatId: string = config.telegramAdminChatId;

export function adminOnly(ctx: Context, next: () => Promise<void>) {
  const chatId = String(ctx.chat?.id ?? "");

  if (dynamicAdminChatId) {
    if (chatId !== dynamicAdminChatId) {
      logger.warn("Telegram: unauthorized access attempt", { chatId });
      return;
    }
  } else {
    // Single-user mode: first user becomes admin
    dynamicAdminChatId = chatId;
    logger.info("Telegram: auto-assigned admin", { chatId });
  }

  return next();
}

export function logMessage(ctx: Context, next: () => Promise<void>) {
  const text =
    ctx.message && "text" in ctx.message ? ctx.message.text : "[non-text]";
  logger.info("Telegram message", {
    chatId: String(ctx.chat?.id ?? ""),
    text,
  });
  return next();
}
