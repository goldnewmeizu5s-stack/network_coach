import { Context } from "telegraf";
import { config } from "../config";
import { logger } from "../lib/logger";
import prisma from "../lib/prisma";

let dynamicAdminChatId: string = config.telegramAdminChatId;
let chatIdPersisted = false;

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

  // Persist chat_id to User on first interaction (fire-and-forget)
  if (!chatIdPersisted) {
    chatIdPersisted = true;
    persistChatId(chatId).catch((err) =>
      logger.error("Failed to persist chat_id", { error: String(err) }),
    );
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

async function persistChatId(chatId: string): Promise<void> {
  const user = await prisma.user.findFirst();
  if (!user) return;
  if (user.telegram_chat_id === chatId) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { telegram_chat_id: chatId },
  });
  logger.info("Telegram: chat_id persisted to User", { chatId });
}
