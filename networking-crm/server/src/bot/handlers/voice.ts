import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { transcribeAudio } from "../../services/transcription";
import { polishTranscript } from "../../services/transcript-polish";
import { extractContactData } from "../../services/ai-extraction";
import { correctTranscript } from "../../services/transcript-correction";
import { createContact } from "../../services/voice-pipeline";
import { recalcAndAutoStatus } from "../../services/warmth";
import { getState, setState, clearState } from "../state";
import { handleChatVoice } from "./chat";
import { esc, divider, thinDivider } from "../ui";

const UPLOADS_DIR = path.join(__dirname, "../../../uploads");
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

// How many chars of transcript to show in one Telegram message
const TRANSCRIPT_PREVIEW_LIMIT = 3500;

export function registerVoiceHandlers(bot: Telegraf) {
  bot.on("voice", (ctx) => handleAudio(ctx, ctx.message.voice));
  bot.on("video_note", (ctx) => handleAudio(ctx, ctx.message.video_note));
  bot.on("audio", (ctx) => handleAudio(ctx, ctx.message.audio));

  // Review flow callbacks
  bot.action("voice_accept", handleVoiceAccept);
  bot.action("voice_edit", handleVoiceEdit);

  // Social links collection
  bot.action(/^socials_skip:(.+)$/, handleSocialsSkip);
}

/**
 * Handle text correction when user is in voice_editing state.
 * Called from the main text handler.
 */
export async function handleVoiceCorrectionText(ctx: Context, text: string) {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);
  if (!state || state.action !== "voice_editing") return;

  const originalTranscript = state.data.transcript as string;
  const interactionId = state.data.interactionId as string;

  const statusMsg = await ctx.reply("🤖 Корректирую текст...");

  try {
    const corrected = await correctTranscript(originalTranscript, text);

    // Update state with corrected transcript
    setState(chatId, "voice_review", {
      transcript: corrected,
      interactionId,
    });

    const preview = corrected.length > TRANSCRIPT_PREVIEW_LIMIT
      ? corrected.slice(0, TRANSCRIPT_PREVIEW_LIMIT) + "..."
      : corrected;

    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      [
        "📝 <b>Исправленная транскрипция</b>",
        divider(),
        "",
        `<i>${esc(preview)}</i>`,
        "",
        thinDivider(),
        "Всё верно? Или хочешь ещё поправить?",
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Принять", "voice_accept"),
            Markup.button.callback("✏️ Ещё правка", "voice_edit"),
          ],
        ]),
      },
    );
  } catch (err) {
    logger.error("Voice correction failed", { error: String(err) });
    // Keep the original transcript in review state
    setState(chatId, "voice_review", {
      transcript: originalTranscript,
      interactionId,
    });
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      "❌ Не удалось скорректировать. Попробуй ещё раз или нажми «Принять».",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Принять как есть", "voice_accept"),
            Markup.button.callback("✏️ Попробовать снова", "voice_edit"),
          ],
        ]),
      },
    ).catch(() => {});
  }
}

/**
 * Handle voice correction — user sends another voice to correct the transcript.
 * Called from handleAudio when state is voice_editing.
 */
async function handleVoiceCorrectionVoice(
  ctx: Context,
  fileInfo: { file_id: string; file_size?: number; duration?: number },
) {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);
  if (!state || state.action !== "voice_editing") return;

  const statusMsg = await ctx.reply("🎤 Распознаю правку...");
  const fileName = `tg-correction-${Date.now()}.ogg`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    const fileLink = await ctx.telegram.getFileLink(fileInfo.file_id);
    const res = await fetch(fileLink.href);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download file: ${res.status}`);
    }
    const fileStream = fs.createWriteStream(filePath);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream);

    const correctionText = await transcribeAudio(filePath);

    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      `🎤 <i>${esc(correctionText)}</i>\n\n🤖 Корректирую...`,
      { parse_mode: "HTML" },
    );

    // Now apply correction
    const originalTranscript = state.data.transcript as string;
    const interactionId = state.data.interactionId as string;

    const corrected = await correctTranscript(originalTranscript, correctionText);

    setState(chatId, "voice_review", {
      transcript: corrected,
      interactionId,
    });

    const preview = corrected.length > TRANSCRIPT_PREVIEW_LIMIT
      ? corrected.slice(0, TRANSCRIPT_PREVIEW_LIMIT) + "..."
      : corrected;

    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      [
        "📝 <b>Исправленная транскрипция</b>",
        divider(),
        "",
        `<i>${esc(preview)}</i>`,
        "",
        thinDivider(),
        "Всё верно? Или хочешь ещё поправить?",
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Принять", "voice_accept"),
            Markup.button.callback("✏️ Ещё правка", "voice_edit"),
          ],
        ]),
      },
    );
  } catch (err) {
    logger.error("Voice correction (voice) failed", { error: String(err) });
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      "❌ Не удалось распознать правку. Попробуй текстом или нажми «Принять».",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Принять как есть", "voice_accept"),
            Markup.button.callback("✏️ Попробовать снова", "voice_edit"),
          ],
        ]),
      },
    ).catch(() => {});
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}

// ── Main voice handler ──────────────────────────────────

async function handleAudio(
  ctx: Context,
  fileInfo: { file_id: string; file_size?: number; duration?: number },
) {
  if (fileInfo.file_size && fileInfo.file_size > MAX_FILE_SIZE) {
    await ctx.reply("❌ Файл слишком большой (максимум 25 МБ).", {
      parse_mode: "HTML",
    });
    return;
  }

  const chatId = ctx.chat!.id;
  const state = getState(chatId);

  // AI chat mode — transcribe and send to chat
  if (state?.action === "ai_chat") {
    return handleChatVoiceMessage(ctx, fileInfo);
  }

  // Voice correction mode — transcribe correction voice
  if (state?.action === "voice_editing") {
    return handleVoiceCorrectionVoice(ctx, fileInfo);
  }

  const statusMsg = await ctx.reply("⏳ Загружаю файл...");
  const messageId = statusMsg.message_id;

  const fileName = `tg-${Date.now()}.ogg`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    // Download file from Telegram
    const fileLink = await ctx.telegram.getFileLink(fileInfo.file_id);
    const res = await fetch(fileLink.href);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download file: ${res.status}`);
    }
    const fileStream = fs.createWriteStream(filePath);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream);

    // Progress: transcribing
    await editMessage(ctx, chatId, messageId, "🎤 Распознаю речь...").catch(() => {});

    // Create Interaction + AudioFile
    const interaction = await prisma.interaction.create({
      data: { type: "voice_note" },
    });
    await prisma.audioFile.create({
      data: {
        interaction_id: interaction.id,
        file_path: filePath,
        duration_seconds: fileInfo.duration ?? null,
        transcription_status: "processing",
      },
    });

    // Transcribe
    let transcript: string;
    try {
      transcript = await transcribeAudio(filePath);
    } catch (err) {
      await prisma.audioFile.update({
        where: { interaction_id: interaction.id },
        data: { transcription_status: "failed" },
      });
      logger.error("Telegram voice: transcription failed", {
        error: String(err),
      });
      await editMessage(
        ctx,
        chatId,
        messageId,
        "❌ Не удалось распознать речь. Попробуй записать ещё раз.",
      );
      return;
    }

    // Polish transcript with AI (fix speech-to-text errors)
    await editMessage(ctx, chatId, messageId, "✨ Причёсываю текст...").catch(() => {});

    const polished = await polishTranscript(transcript);

    // Save both raw and polished transcript
    await prisma.interaction.update({
      where: { id: interaction.id },
      data: { transcript: polished },
    });
    await prisma.audioFile.update({
      where: { interaction_id: interaction.id },
      data: { file_path: "deleted", transcription_status: "completed" },
    });

    // ── Show polished transcript for review ─────────────
    setState(chatId, "voice_review", {
      transcript: polished,
      interactionId: interaction.id,
    });

    const preview = transcript.length > TRANSCRIPT_PREVIEW_LIMIT
      ? transcript.slice(0, TRANSCRIPT_PREVIEW_LIMIT) + "..."
      : transcript;

    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      [
        "📝 <b>Транскрипция</b>",
        divider(),
        "",
        `<i>${esc(preview)}</i>`,
        "",
        thinDivider(),
        "Проверь текст. Если всё верно — нажми «Принять».",
        "Если есть ошибки — нажми «Редактировать» и опиши,",
        "что исправить (текстом или голосовым).",
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Принять", "voice_accept"),
            Markup.button.callback("✏️ Редактировать", "voice_edit"),
          ],
        ]),
      },
    );
  } catch (err) {
    logger.error("Telegram voice handler error", { error: String(err) });
    await editMessage(
      ctx,
      chatId,
      messageId,
      "❌ Произошла ошибка при обработке записи.",
    ).catch(() => {});
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}

// ── Review callbacks ─────────────────────────────────────

async function handleVoiceAccept(ctx: Context) {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);

  if (!state || state.action !== "voice_review") {
    await ctx.answerCbQuery("Сессия истекла. Запиши голосовое заново.");
    return;
  }

  const transcript = state.data.transcript as string;
  const interactionId = state.data.interactionId as string;
  clearState(chatId);

  try {
    await ctx.answerCbQuery("🤖 Анализирую...");
  } catch { /* ignore */ }

  // Update the message to show progress
  try {
    await ctx.editMessageText(
      "🤖 Анализирую контакт из транскрипции...",
      { parse_mode: "HTML" },
    );
  } catch { /* ignore */ }

  try {
    // Update transcript in DB (may have been corrected)
    await prisma.interaction.update({
      where: { id: interactionId },
      data: { transcript },
    });

    // Extract contact data
    let extracted: Awaited<ReturnType<typeof extractContactData>>;
    try {
      extracted = await extractContactData(transcript);
    } catch (err) {
      logger.error("Telegram voice: extraction failed", {
        error: String(err),
      });
      await ctx.editMessageText(
        "⚠️ Запись сохранена, но не удалось извлечь контакт автоматически.",
        { parse_mode: "HTML" },
      );
      return;
    }

    // No person detected
    if (extracted.is_update === null) {
      await prisma.interaction.update({
        where: { id: interactionId },
        data: { ai_summary: "Voice note (no contact detected)" },
      });
      await ctx.editMessageText(
        "📝 Запись сохранена (контакт не распознан).",
        { parse_mode: "HTML" },
      );
      return;
    }

    // Resolve or create contact
    let contactId: string;
    let isNew = false;

    if (extracted.is_update && extracted.full_name) {
      const existing = await prisma.contact.findFirst({
        where: {
          full_name: { contains: extracted.full_name, mode: "insensitive" },
        },
      });
      if (existing) {
        contactId = existing.id;
        await updateContact(contactId, extracted);
      } else {
        const contact = await createContact(extracted);
        contactId = contact.id;
        isNew = true;
      }
    } else {
      const contact = await createContact(extracted);
      contactId = contact.id;
      isNew = true;
    }

    // Link interaction
    await prisma.interaction.update({
      where: { id: interactionId },
      data: { contact_id: contactId, ai_summary: extracted.memory_summary },
    });

    // Create follow-up
    if (extracted.suggested_next_steps.length > 0) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 2);
      await prisma.followUp.create({
        data: {
          contact_id: contactId,
          suggested_action: extracted.suggested_next_steps[0],
          due_date: dueDate,
          priority: extracted.urgency_score,
        },
      });
    }

    await recalcAndAutoStatus(contactId);

    // Show contact card
    const text = formatContactMessage(extracted, isNew);
    await ctx.editMessageText(text, { parse_mode: "HTML" });

    // Ask for social links in a SEPARATE message (so it's clearly visible)
    setState(chatId, "awaiting_socials", { contactId });

    await ctx.reply(
      [
        "📲 <b>Есть контакт этого человека?</b>",
        "",
        "Вставь ссылку или юзернейм (Telegram, WhatsApp,",
        "Instagram, LinkedIn — что угодно).",
        "",
        "Можно несколько — каждый с новой строки.",
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⏭ Пропустить", `socials_skip:${contactId}`)],
        ]),
      },
    );
  } catch (err) {
    logger.error("Voice accept error", { error: String(err) });
    await ctx.editMessageText(
      "❌ Произошла ошибка при создании контакта.",
      { parse_mode: "HTML" },
    ).catch(() => {});
  }
}

async function handleVoiceEdit(ctx: Context) {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);

  if (!state || state.action !== "voice_review") {
    await ctx.answerCbQuery("Сессия истекла. Запиши голосовое заново.");
    return;
  }

  try {
    await ctx.answerCbQuery();
  } catch { /* ignore */ }

  // Switch to editing state (keep transcript and interactionId)
  setState(chatId, "voice_editing", {
    transcript: state.data.transcript,
    interactionId: state.data.interactionId,
  });

  await ctx.editMessageText(
    [
      "✏️ <b>Режим редактирования</b>",
      divider(),
      "",
      "Опиши, что нужно исправить — текстом или голосовым.",
      "",
      "Примеры:",
      '· «Его зовут Алексей, а не Александр»',
      '· «Он работает в Яндексе, не в Гугле»',
      '· «Добавь, что мы познакомились на конференции»',
      "",
      "<i>Я учту твои правки и покажу обновлённый текст.</i>",
    ].join("\n"),
    { parse_mode: "HTML" },
  );
}

// ── Social links collection ──────────────────────────────

async function handleSocialsSkip(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];
  clearState(ctx.chat!.id);

  try {
    await ctx.answerCbQuery();
  } catch { /* ignore */ }

  await ctx.editMessageText(
    "✅ Готово!",
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("👤 Открыть", `contact_view:${contactId}`),
          Markup.button.callback("📋 Follow-ups", `contact_fups:${contactId}`),
        ],
        [Markup.button.callback("🏠 Меню", "main_menu")],
      ]),
    },
  );
}

/**
 * Handle text input when user is in awaiting_socials state.
 * Parses links/usernames and saves as social_links.
 * Called from the main text handler.
 */
export async function handleSocialsText(ctx: Context, text: string) {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);
  if (!state || state.action !== "awaiting_socials") return;

  const contactId = state.data.contactId as string;
  clearState(chatId);

  const links = parseSocialLinks(text);

  if (Object.keys(links).length === 0) {
    // Couldn't parse — save as raw note
    await prisma.interaction.create({
      data: {
        contact_id: contactId,
        type: "note",
        content: `Contact info: ${text}`,
      },
    });
    await ctx.reply(
      "📝 Сохранил как заметку к контакту.",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("👤 Открыть", `contact_view:${contactId}`),
            Markup.button.callback("📋 Follow-ups", `contact_fups:${contactId}`),
          ],
          [Markup.button.callback("🏠 Меню", "main_menu")],
        ]),
      },
    );
    return;
  }

  // Merge with existing social_links
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { social_links: true },
    });
    const existing = (contact?.social_links as Record<string, string>) || {};
    const merged = { ...existing, ...links };

    const { Prisma } = await import("@prisma/client");
    await prisma.contact.update({
      where: { id: contactId },
      data: { social_links: merged },
    });

    const saved = Object.entries(merged)
      .map(([k, v]) => `${platformLabel(k)}: ${v}`)
      .join("\n");

    await ctx.reply(
      `✅ Контакты сохранены!\n\n${saved}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("👤 Открыть", `contact_view:${contactId}`),
            Markup.button.callback("📋 Follow-ups", `contact_fups:${contactId}`),
          ],
          [Markup.button.callback("🏠 Меню", "main_menu")],
        ]),
      },
    );
  } catch (err) {
    logger.error("Failed to save social links", { error: String(err) });
    await ctx.reply("❌ Не удалось сохранить контакты.");
  }
}

function platformLabel(key: string): string {
  const labels: Record<string, string> = {
    telegram: "Telegram",
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    facebook: "Facebook",
    twitter: "Twitter / X",
    phone: "Телефон",
    email: "Email",
  };
  return labels[key] || key;
}

/**
 * Parse social links from user input.
 * Handles URLs, @usernames, phone numbers, emails.
 */
function parseSocialLinks(text: string): Record<string, string> {
  const links: Record<string, string> = {};
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Telegram links
    if (/t\.me\//i.test(line) || /telegram/i.test(line)) {
      const match = line.match(/t\.me\/([a-zA-Z0-9_]+)/i);
      links.telegram = match ? `@${match[1]}` : line.trim();
      continue;
    }

    // WhatsApp links
    if (/wa\.me\//i.test(line) || /whatsapp/i.test(line)) {
      const match = line.match(/wa\.me\/(\+?\d+)/i);
      links.whatsapp = match ? match[1] : line.trim();
      continue;
    }

    // Instagram
    if (/instagram\.com/i.test(line) || /instagr\.am/i.test(line) || /^@?[a-zA-Z0-9_.]+$/i.test(line) && /inst/i.test(line)) {
      const match = line.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
      links.instagram = match ? `@${match[1]}` : line.trim();
      continue;
    }

    // LinkedIn
    if (/linkedin\.com/i.test(line)) {
      links.linkedin = line.trim();
      continue;
    }

    // Facebook
    if (/facebook\.com/i.test(line) || /fb\.com/i.test(line)) {
      links.facebook = line.trim();
      continue;
    }

    // Twitter / X
    if (/twitter\.com/i.test(line) || /x\.com\//i.test(line)) {
      const match = line.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/i);
      links.twitter = match ? `@${match[1]}` : line.trim();
      continue;
    }

    // Email
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line)) {
      links.email = line.trim();
      continue;
    }

    // Phone number
    if (/^\+?\d[\d\s\-()]{6,}$/.test(line.replace(/\s/g, ""))) {
      links.phone = line.trim();
      continue;
    }

    // @username — assume Telegram if single username without context
    if (/^@[a-zA-Z0-9_]{3,}$/.test(line)) {
      links.telegram = line.trim();
      continue;
    }

    // Generic URL — store as-is under "other"
    if (/^https?:\/\//i.test(line)) {
      links.other = line.trim();
      continue;
    }

    // If nothing matched but looks like a username/handle
    if (/^[a-zA-Z0-9_.]{3,30}$/.test(line)) {
      // Could be anything — don't guess, save as first empty platform
      if (!links.telegram) {
        links.telegram = `@${line.trim()}`;
      } else if (!links.instagram) {
        links.instagram = `@${line.trim()}`;
      }
      continue;
    }
  }

  return links;
}

// ── Helpers ──────────────────────────────────────────────

async function updateContact(
  contactId: string,
  extracted: Awaited<ReturnType<typeof extractContactData>>,
) {
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      ...(extracted.occupation && { occupation: extracted.occupation }),
      ...(extracted.company && { company: extracted.company }),
      ...(extracted.city && { city: extracted.city }),
      ...(extracted.country && { country: extracted.country }),
      ...(extracted.key_interests.length && {
        key_interests: extracted.key_interests,
      }),
      ...(extracted.what_impressed_me && {
        what_impressed_me: extracted.what_impressed_me,
      }),
      ...(extracted.potential_synergies && {
        potential_synergies: extracted.potential_synergies,
      }),
      ...(extracted.personality_notes && {
        personality_notes: extracted.personality_notes,
      }),
      ...(extracted.memory_summary && {
        memory_summary: extracted.memory_summary,
      }),
      ...(extracted.relationship_category && {
        relationship_category: extracted.relationship_category,
      }),
      urgency_score: extracted.urgency_score,
      last_interaction_at: new Date(),
    },
  });
}

function formatContactMessage(
  extracted: Awaited<ReturnType<typeof extractContactData>>,
  isNew: boolean,
): string {
  const header = isNew ? "✅ <b>Контакт создан!</b>" : "♻️ <b>Контакт обновлён!</b>";
  const lines: string[] = [
    header,
    divider(),
    "",
  ];

  if (extracted.full_name) {
    lines.push(`👤 <b>${esc(extracted.full_name)}</b>`);
  }

  const jobParts: string[] = [];
  if (extracted.occupation) jobParts.push(esc(extracted.occupation));
  if (extracted.company) jobParts.push(`@ ${esc(extracted.company)}`);
  if (jobParts.length) lines.push(`💼 ${jobParts.join(" ")}`);

  if (extracted.city) lines.push(`📍 ${esc(extracted.city)}`);

  if (extracted.memory_summary) {
    lines.push("");
    lines.push(`💡 <i>${esc(extracted.memory_summary)}</i>`);
  }

  if (extracted.suggested_next_steps.length > 0) {
    lines.push("", thinDivider(), "");
    lines.push("📌 <b>Следующие шаги:</b>");
    extracted.suggested_next_steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${esc(step)}`);
    });
  }

  return lines.join("\n");
}

function editMessage(
  ctx: Context,
  chatId: number,
  messageId: number,
  text: string,
) {
  return ctx.telegram.editMessageText(chatId, messageId, undefined, text, {
    parse_mode: "HTML",
  });
}

/** Handle voice in AI chat mode: transcribe → send to chat pipeline */
async function handleChatVoiceMessage(
  ctx: Context,
  fileInfo: { file_id: string; file_size?: number; duration?: number },
) {
  const statusMsg = await ctx.reply("🎤 Распознаю речь...");
  const chatId = ctx.chat!.id;
  const fileName = `tg-chat-${Date.now()}.ogg`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    const fileLink = await ctx.telegram.getFileLink(fileInfo.file_id);
    const res = await fetch(fileLink.href);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download file: ${res.status}`);
    }
    const fileStream = fs.createWriteStream(filePath);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream);

    const transcript = await transcribeAudio(filePath);

    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      `🎤 <i>${esc(transcript)}</i>`,
      { parse_mode: "HTML" },
    );

    await handleChatVoice(ctx, transcript);
  } catch (err) {
    logger.error("Chat voice transcription failed", { error: String(err) });
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      "❌ Не удалось распознать речь. Попробуй ещё раз.",
    ).catch(() => {});
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}
