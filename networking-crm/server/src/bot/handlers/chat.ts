import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import { logger } from "../../lib/logger";
import { processChat } from "../../services/chat-service";
import { setState, clearState } from "../state";
import { esc } from "../ui";

const CHAT_EXPIRE_MS = 30 * 60 * 1000; // 30 minutes

const QUICK_QUESTIONS: Record<string, string> = {
  quick_weekly_summary: "Подведи итоги моей недели в нетворкинге",
  quick_what_today: "Что мне стоит сделать сегодня?",
  quick_neglected: "С кем я давно не общался? Кого стоит вспомнить?",
  quick_advice: "Дай мне один конкретный совет по нетворкингу на сегодня",
};

const TG_MSG_LIMIT = 4096;

// Allowed HTML tags in Telegram
const ALLOWED_TAGS = /(<\/?(?:b|i|u|s|code|pre|a(?:\s[^>]*)?)>)/g;

export function registerChatHandlers(bot: Telegraf) {
  bot.action("ai_chat", handleActivateChat);
  bot.action("chat_exit", handleExitChat);

  bot.action(/^contact_chat:(.+)$/, handleContactChat);

  for (const key of Object.keys(QUICK_QUESTIONS)) {
    bot.action(key, handleQuickQuestion);
  }
}

/**
 * Process a text message in AI chat mode.
 * Called from the main text handler when state.action === 'ai_chat'.
 */
export async function handleChatMessage(ctx: Context, text: string) {
  const chatId = ctx.chat!.id;
  const contactId =
    (await import("../state")).getState(chatId)?.data?.contactId as
      | string
      | undefined;

  await sendAiResponse(ctx, text, contactId);

  // Refresh chat state expiry
  setState(chatId, "ai_chat", contactId ? { contactId } : {});
}

/**
 * Process voice in AI chat mode — transcribe and send as chat message.
 */
export async function handleChatVoice(ctx: Context, transcript: string) {
  const chatId = ctx.chat!.id;
  const contactId =
    (await import("../state")).getState(chatId)?.data?.contactId as
      | string
      | undefined;

  await ctx.reply(`🎤 <i>${esc(transcript)}</i>`, {
    parse_mode: "HTML",
  });

  await sendAiResponse(ctx, transcript, contactId);

  setState(chatId, "ai_chat", contactId ? { contactId } : {});
}

// ── Handlers ──────────────────────────────────────────────

async function handleActivateChat(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    setState(ctx.chat!.id, "ai_chat", {});

    const text = [
      "💬 <b>AI-чат активирован</b>",
      "",
      "Просто пиши мне — я отвечу с учётом всех твоих контактов и данных.",
      "",
      "Примеры вопросов:",
      "• Что мне делать сегодня?",
      "• С кем давно не общался?",
      "• Как подготовиться к конференции?",
      "• Помоги написать сообщение для [Имя]",
    ].join("\n");

    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...chatKeyboard(),
    });
  } catch (err) {
    logger.error("activate chat error", { error: String(err) });
  }
}

async function handleExitChat(ctx: Context) {
  try {
    await ctx.answerCbQuery();
    clearState(ctx.chat!.id);

    const { mainMenuKeyboard, MAIN_MENU_TEXT } = await import("../keyboards");
    await ctx.editMessageText(MAIN_MENU_TEXT, {
      parse_mode: "HTML",
      ...mainMenuKeyboard,
    });
  } catch (err) {
    logger.error("exit chat error", { error: String(err) });
  }
}

async function handleContactChat(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];

  try {
    await ctx.answerCbQuery();

    const prisma = (await import("../../lib/prisma")).default;
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { full_name: true },
    });
    if (!contact) {
      await ctx.reply("❌ Контакт не найден.");
      return;
    }

    setState(ctx.chat!.id, "ai_chat", { contactId });

    await ctx.reply(
      `💬 Чат в контексте <b>${esc(contact.full_name)}</b>.\nСпрашивай что угодно об этом контакте.`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🏠 Выйти из чата", "chat_exit")],
        ]),
      },
    );
  } catch (err) {
    logger.error("contact chat error", { error: String(err) });
  }
}

async function handleQuickQuestion(ctx: Context) {
  const data = (ctx.callbackQuery as any)?.data as string;
  const question = QUICK_QUESTIONS[data];
  if (!question) return;

  try {
    await ctx.answerCbQuery();

    // Make sure we're in chat mode
    setState(ctx.chat!.id, "ai_chat", {});

    await sendAiResponse(ctx, question);
  } catch (err) {
    logger.error("quick question error", { error: String(err) });
  }
}

// ── Core AI response ──────────────────────────────────────

async function sendAiResponse(
  ctx: Context,
  message: string,
  contactId?: string,
) {
  try {
    await ctx.sendChatAction("typing");

    const response = await processChat(message, contactId);
    const sanitized = sanitizeHtmlForTelegram(response);

    // Split long messages
    const parts = splitMessage(sanitized);

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      await ctx.reply(parts[i], {
        parse_mode: "HTML",
        ...(isLast ? chatKeyboard() : {}),
      });
    }
  } catch (err) {
    logger.error("AI chat error", { error: String(err) });
    await ctx.reply("❌ Не удалось получить ответ от AI. Попробуй ещё раз.", {
      parse_mode: "HTML",
      ...chatKeyboard(),
    });
  }
}

// ── Helpers ───────────────────────────────────────────────

function chatKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📊 Итоги недели", "quick_weekly_summary"),
      Markup.button.callback("🤔 Что делать?", "quick_what_today"),
    ],
    [
      Markup.button.callback("👥 Кого вспомнить?", "quick_neglected"),
      Markup.button.callback("💡 Совет", "quick_advice"),
    ],
    [Markup.button.callback("🏠 Выйти из чата", "chat_exit")],
  ]);
}

/**
 * Escape HTML special chars but preserve allowed Telegram HTML tags.
 */
function sanitizeHtmlForTelegram(text: string): string {
  // Split by allowed tags to preserve them
  const parts = text.split(ALLOWED_TAGS);
  return parts
    .map((part) => {
      // If this part matches an allowed tag, keep it as-is
      if (ALLOWED_TAGS.test(part)) {
        // Reset regex lastIndex
        ALLOWED_TAGS.lastIndex = 0;
        return part;
      }
      // Otherwise escape HTML entities
      return part
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    })
    .join("");
}

/**
 * Split long message into parts respecting paragraph boundaries.
 */
function splitMessage(text: string): string[] {
  if (text.length <= TG_MSG_LIMIT) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > TG_MSG_LIMIT) {
    // Find last paragraph break within limit
    let splitAt = remaining.lastIndexOf("\n\n", TG_MSG_LIMIT);
    if (splitAt < TG_MSG_LIMIT / 2) {
      // No good paragraph break — try single newline
      splitAt = remaining.lastIndexOf("\n", TG_MSG_LIMIT);
    }
    if (splitAt < TG_MSG_LIMIT / 2) {
      // No good newline — try sentence end
      splitAt = remaining.lastIndexOf(". ", TG_MSG_LIMIT);
      if (splitAt > 0) splitAt += 1; // Include the period
    }
    if (splitAt < TG_MSG_LIMIT / 4) {
      // Last resort — hard cut
      splitAt = TG_MSG_LIMIT;
    }

    parts.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) parts.push(remaining);
  return parts;
}
