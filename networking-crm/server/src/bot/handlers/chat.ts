import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import { logger } from "../../lib/logger";
import { config } from "../../config";
import { processChat } from "../../services/chat-service";
import { setState, clearState } from "../state";
import { esc, divider, markdownToTelegramHtml, fmtError } from "../ui";

const CHAT_EXPIRE_MS = 30 * 60 * 1000; // 30 minutes

const QUICK_QUESTIONS: Record<string, string> = {
  quick_weekly_summary: "Подведи итоги моей недели в нетворкинге",
  quick_what_today: "Что мне стоит сделать сегодня?",
  quick_neglected: "С кем я давно не общался? Кого стоит вспомнить?",
  quick_advice: "Дай мне один конкретный совет по нетворкингу на сегодня",
};

const TG_MSG_LIMIT = 4096;

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
      "<b>AI-чат</b>",
      "",
      "пиши или отправляй голосовые.",
      "отвечу с учётом всех твоих контактов.",
      "",
      "<i>что делать с Алексеем?</i>",
      "<i>подготовь к конференции.</i>",
      "<i>кому давно не писал?</i>",
    ].join("\n");

    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...chatKeyboard(),
    });
  } catch (err) {
    logger.error("activate chat error", { error: String(err) });
    await ctx.reply(`❌ Ошибка активации чата:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

async function handleExitChat(ctx: Context) {
  try {
    await ctx.answerCbQuery();
    clearState(ctx.chat!.id);

    const { buildMainMenu } = await import("../keyboards");
    const { text: menuText, keyboard } = await buildMainMenu();

    await ctx.editMessageText(`💬 Чат завершён.\n\n${menuText}`, {
      parse_mode: "HTML",
      ...keyboard,
    });
  } catch (err) {
    logger.error("exit chat error", { error: String(err) });
    await ctx.reply(`❌ Ошибка выхода из чата:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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

    const text = [
      `💬 <b>Чат · ${esc(contact.full_name)}</b>`,
      divider(),
      "",
      "Спрашивай что угодно об этом контакте.",
      "Я вижу всю его историю и данные.",
    ].join("\n");

    await ctx.reply(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("🤔 Что делать?", "quick_what_today"),
          Markup.button.callback("✉️ Написать ему", "quick_advice"),
        ],
        [Markup.button.callback("🚪 Выйти", "chat_exit")],
      ]),
    });
  } catch (err) {
    logger.error("contact chat error", { error: String(err) });
    await ctx.reply(`❌ Ошибка открытия чата с контактом:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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

    // Show the question from user before AI response
    await ctx.reply(`🙋 <i>${esc(question)}</i>`, {
      parse_mode: "HTML",
    });

    await sendAiResponse(ctx, question);
  } catch (err) {
    logger.error("quick question error", { error: String(err) });
    await ctx.reply(`❌ Ошибка быстрого вопроса:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
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
    const sanitized = markdownToTelegramHtml(response);

    // Wrap in AI visual frame
    const framed = `🤖 ${sanitized}`;

    // Split long messages
    const parts = splitMessage(framed);

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      await ctx.reply(parts[i], {
        parse_mode: "HTML",
        ...(isLast ? chatKeyboard() : {}),
      });
    }
  } catch (err) {
    logger.error("AI chat error", { error: String(err) });
    await ctx.reply(`❌ Не удалось получить ответ от AI:\n\n<pre>${fmtError(err)}</pre>`, {
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
    ...(config.webappUrl
      ? [[Markup.button.webApp("\u{1F4AC} Полный чат", `${config.webappUrl}/chat`)]]
      : []),
    [Markup.button.callback("🚪 Выйти", "chat_exit")],
  ]);
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
