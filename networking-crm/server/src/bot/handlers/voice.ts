import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { transcribeAudio } from "../../services/transcription";
import { extractContactData } from "../../services/ai-extraction";
import { createContact } from "../../services/voice-pipeline";
import { recalcAndAutoStatus } from "../../services/warmth";
import { getState } from "../state";
import { handleChatVoice } from "./chat";
import { esc } from "../ui";

const UPLOADS_DIR = path.join(__dirname, "../../../uploads");
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export function registerVoiceHandlers(bot: Telegraf) {
  bot.on("voice", (ctx) => handleAudio(ctx, ctx.message.voice));
  bot.on("video_note", (ctx) => handleAudio(ctx, ctx.message.video_note));
  bot.on("audio", (ctx) => handleAudio(ctx, ctx.message.audio));
}

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

  // Check if we're in AI chat mode — if so, transcribe and send to chat
  const state = getState(ctx.chat!.id);
  if (state?.action === "ai_chat") {
    return handleChatVoiceMessage(ctx, fileInfo);
  }

  const statusMsg = await ctx.reply("⏳ Обрабатываю запись...");
  const chatId = ctx.chat!.id;
  const messageId = statusMsg.message_id;

  const fileName = `tg-${Date.now()}.ogg`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  try {
    // Ensure uploads dir exists
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    // Download file from Telegram
    const fileLink = await ctx.telegram.getFileLink(fileInfo.file_id);
    const res = await fetch(fileLink.href);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download file: ${res.status}`);
    }
    const fileStream = fs.createWriteStream(filePath);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream);

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

    // Save transcript, clean up file marker
    await prisma.interaction.update({
      where: { id: interaction.id },
      data: { transcript },
    });
    await prisma.audioFile.update({
      where: { interaction_id: interaction.id },
      data: { file_path: "deleted" },
    });

    // Extract contact data
    let extracted: Awaited<ReturnType<typeof extractContactData>>;
    try {
      extracted = await extractContactData(transcript);
    } catch (err) {
      await prisma.audioFile.update({
        where: { interaction_id: interaction.id },
        data: { transcription_status: "completed" },
      });
      logger.error("Telegram voice: extraction failed", {
        error: String(err),
      });
      await editMessage(
        ctx,
        chatId,
        messageId,
        "⚠️ Запись сохранена, но не удалось извлечь контакт автоматически.",
      );
      return;
    }

    // No person detected
    if (extracted.is_update === null) {
      await prisma.interaction.update({
        where: { id: interaction.id },
        data: { ai_summary: "Voice note (no contact detected)" },
      });
      await prisma.audioFile.update({
        where: { interaction_id: interaction.id },
        data: { transcription_status: "completed" },
      });
      await editMessage(
        ctx,
        chatId,
        messageId,
        "📝 Запись сохранена (контакт не распознан).",
      );
      return;
    }

    // Resolve or create contact (same logic as voice-pipeline.ts)
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
      where: { id: interaction.id },
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

    await prisma.audioFile.update({
      where: { interaction_id: interaction.id },
      data: { transcription_status: "completed" },
    });

    // Format response
    const text = formatContactMessage(extracted, isNew);
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("👤 Открыть", `contact_view:${contactId}`),
        Markup.button.callback("✏️ Редактировать", `contact_edit:${contactId}`),
      ],
      [Markup.button.callback("🗑 Удалить", `contact_delete:${contactId}`)],
    ]);

    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      text,
      { parse_mode: "HTML", ...keyboard },
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
    // Always clean up temp file
    try {
      fs.unlinkSync(filePath);
    } catch {
      // file already deleted or never created
    }
  }
}

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
  const header = isNew ? "✅ Контакт создан!" : "♻️ Контакт обновлён!";
  const lines: string[] = [header, ""];

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
    lines.push("");
    lines.push("Следующие шаги:");
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
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
}
