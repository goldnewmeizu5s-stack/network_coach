import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { config } from "../../config";
import { recalcAndAutoStatus } from "../../services/warmth";
import { draftFollowUpMessage } from "../../services/message-drafting";
import { setState } from "../state";
import {
  esc,
  dayWord,
  fmtDateShort,
  divider,
  thinDivider,
  warmthEmoji,
  warmthLabel,
  urgencyBadge,
  editOrReply,
  safeAnswer,
} from "../ui";

export function registerFollowupHandlers(bot: Telegraf) {
  // Main menu entry
  bot.action("followups", handleFollowupsMenu);

  // Navigate between follow-ups
  bot.action(/^fu_show:(\d+)$/, handleShowByIndex);

  // Actions
  bot.action(/^fu_done:(.+)$/, handleDone);
  bot.action(/^fu_snooze:(.+):(\d+)$/, handleSnooze);
  bot.action(/^fu_skip:(.+)$/, handleSkip);
  bot.action(/^fu_draft:(.+)$/, handleDraft);
  bot.action(/^fu_mark_done_after_draft:(.+)$/, handleMarkDoneAfterDraft);

  // Contact follow-ups view
  bot.action(/^contact_fups:(.+)$/, handleContactFollowups);

  // Create manually
  bot.action(/^fu_create:(.+)$/, handleCreatePrompt);
  bot.action(/^fu_set_date:(.+):(\d+)$/, handleSetDate);
}

// ── Data helpers ──────────────────────────────────────────

async function loadPendingFollowups() {
  const now = new Date();
  return prisma.followUp.findMany({
    where: {
      OR: [
        { status: "pending" },
        { status: "snoozed", snoozed_until: { lte: now } },
      ],
    },
    include: {
      contact: { select: { id: true, full_name: true, warmth_status: true } },
    },
    orderBy: [{ due_date: "asc" }],
    take: 50,
  });
}

// ── Card rendering ────────────────────────────────────────

function renderFollowupCard(
  fu: Awaited<ReturnType<typeof loadPendingFollowups>>[number],
  index: number,
  total: number,
) {
  const { emoji, label } = urgencyBadge(fu.due_date);
  const contactName = fu.contact?.full_name || "Неизвестный";
  const contactStatus = fu.contact?.warmth_status || "new";

  const lines = [
    `📋 <b>Follow-up</b> ${index + 1} из ${total}`,
    divider(),
    "",
    `${emoji} <b>${label}</b>`,
    "",
    `👤 ${esc(contactName)} · ${warmthEmoji(contactStatus)} ${warmthLabel(contactStatus)}`,
    `📌 ${esc(fu.suggested_action)}`,
    `⬆️ Приоритет: ${fu.priority}/10`,
  ];

  return lines.join("\n");
}

function followupButtons(
  fu: Awaited<ReturnType<typeof loadPendingFollowups>>[number],
  index: number,
  total: number,
) {
  const id = fu.id;
  const rows: import("../ui").InlineButtons = [
    [
      Markup.button.callback("✅ Готово", `fu_done:${id}`),
      Markup.button.callback("✉️ Написать", `fu_draft:${id}`),
    ],
    [
      Markup.button.callback("⏰ 2д", `fu_snooze:${id}:2`),
      Markup.button.callback("⏰ 7д", `fu_snooze:${id}:7`),
      Markup.button.callback("⏰ 14д", `fu_snooze:${id}:14`),
      Markup.button.callback("⏭ Пропустить", `fu_skip:${id}`),
    ],
  ];

  // Navigation
  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (index > 0) nav.push(Markup.button.callback("← Пред.", `fu_show:${index - 1}`));
  if (index < total - 1) nav.push(Markup.button.callback("След. →", `fu_show:${index + 1}`));
  if (nav.length) rows.push(nav);

  if (config.webappUrl) {
    rows.push([Markup.button.webApp("\u{1F4CB} Все задачи", `${config.webappUrl}/followups`)]);
  }

  const bottom: ReturnType<typeof Markup.button.callback>[] = [];
  if (fu.contact) {
    bottom.push(Markup.button.callback("👤 К контакту", `contact_view:${fu.contact.id}`));
  }
  bottom.push(Markup.button.callback("🏠 Меню", "main_menu"));
  rows.push(bottom);

  return rows;
}

// ── Handlers ──────────────────────────────────────────────

async function handleFollowupsMenu(ctx: Context) {
  try {
    await ctx.answerCbQuery();
    await showFollowupByIndex(ctx, 0);
  } catch (err) {
    logger.error("followups menu error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка загрузки");
  }
}

async function handleShowByIndex(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const index = parseInt(match[1], 10);
  try {
    await ctx.answerCbQuery();
    await showFollowupByIndex(ctx, index);
  } catch (err) {
    logger.error("followup show error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function showFollowupByIndex(ctx: Context, index: number) {
  const followups = await loadPendingFollowups();

  if (followups.length === 0) {
    await editOrReply(ctx, "🎉 Всё чисто! Нет активных задач.", [
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
    return;
  }

  const safeIndex = Math.min(index, followups.length - 1);
  const fu = followups[safeIndex];
  const text = renderFollowupCard(fu, safeIndex, followups.length);
  const buttons = followupButtons(fu, safeIndex, followups.length);

  await editOrReply(ctx, text, buttons);
}

async function handleDone(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const fuId = match[1];

  try {
    await ctx.answerCbQuery("✅ Выполнено!");

    const fu = await prisma.followUp.findUnique({
      where: { id: fuId },
      select: { contact_id: true, suggested_action: true },
    });
    if (!fu) return;

    await prisma.followUp.update({
      where: { id: fuId },
      data: { status: "done", completed_at: new Date() },
    });

    await prisma.interaction.create({
      data: {
        contact_id: fu.contact_id,
        type: "follow_up",
        content: `Follow-up completed: ${fu.suggested_action}`,
      },
    });

    await prisma.contact.update({
      where: { id: fu.contact_id },
      data: { last_interaction_at: new Date() },
    });

    await recalcAndAutoStatus(fu.contact_id);

    // Show next followup
    await showFollowupByIndex(ctx, 0);
  } catch (err) {
    logger.error("fu done error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleSnooze(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const fuId = match[1];
  const days = parseInt(match[2], 10);

  try {
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + days);

    await prisma.followUp.update({
      where: { id: fuId },
      data: { status: "snoozed", snoozed_until: snoozedUntil },
    });

    await ctx.answerCbQuery(`⏰ Отложено до ${fmtDateShort(snoozedUntil)}`);
    await showFollowupByIndex(ctx, 0);
  } catch (err) {
    logger.error("fu snooze error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleSkip(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const fuId = match[1];

  try {
    await prisma.followUp.update({
      where: { id: fuId },
      data: { status: "skipped" },
    });

    await ctx.answerCbQuery("⏭ Пропущено");
    await showFollowupByIndex(ctx, 0);
  } catch (err) {
    logger.error("fu skip error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleDraft(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const fuId = match[1];

  try {
    await ctx.answerCbQuery();

    const fu = await prisma.followUp.findUnique({
      where: { id: fuId },
      include: { contact: { select: { id: true, full_name: true } } },
    });
    if (!fu || !fu.contact) {
      await ctx.reply("❌ Follow-up не найден.");
      return;
    }

    const statusMsg = await ctx.reply("✉️ Генерирую варианты сообщения...");

    let drafts: string[];
    try {
      drafts = await draftFollowUpMessage(fu.contact_id, fu.suggested_action);
    } catch (err) {
      logger.error("draft followup error", { error: String(err) });
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        "❌ Не удалось сгенерировать сообщение.",
      );
      return;
    }

    const contactName = esc(fu.contact.full_name);
    const actionText = esc(fu.suggested_action);

    // Build single message with all drafts
    const lines = [
      "✉️ <b>Варианты сообщения</b>",
      divider(),
      `👤 Для: ${contactName}`,
      `📌 Действие: ${actionText}`,
      "",
      thinDivider(),
    ];

    drafts.forEach((draft, i) => {
      lines.push("");
      lines.push(`<b>${i + 1}.</b> ${esc(draft)}`);
      if (i < drafts.length - 1) {
        lines.push("");
        lines.push(thinDivider());
      }
    });

    lines.push("");
    lines.push("<i>Скопируй понравившийся вариант</i>");

    const buttons = [
      [Markup.button.callback("✅ Отметить как сделано", `fu_mark_done_after_draft:${fuId}`)],
      [Markup.button.callback("← К follow-ups", "followups")],
    ];

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      lines.join("\n"),
      { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) },
    );
  } catch (err) {
    logger.error("fu draft error", { error: String(err) });
    await ctx.reply("❌ Ошибка генерации сообщения.");
  }
}

async function handleMarkDoneAfterDraft(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const fuId = match[1];

  try {
    await ctx.answerCbQuery("✅ Выполнено!");

    const fu = await prisma.followUp.findUnique({
      where: { id: fuId },
      select: { contact_id: true, suggested_action: true },
    });
    if (!fu) return;

    await prisma.followUp.update({
      where: { id: fuId },
      data: { status: "done", completed_at: new Date() },
    });

    await prisma.interaction.create({
      data: {
        contact_id: fu.contact_id,
        type: "follow_up",
        content: `Follow-up completed: ${fu.suggested_action}`,
      },
    });

    await prisma.contact.update({
      where: { id: fu.contact_id },
      data: { last_interaction_at: new Date() },
    });

    await recalcAndAutoStatus(fu.contact_id);

    await editOrReply(ctx, "✅ Follow-up выполнен! 💪", [
      [Markup.button.callback("← К follow-ups", "followups")],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
  } catch (err) {
    logger.error("fu mark done error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleContactFollowups(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];

  try {
    await ctx.answerCbQuery();

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { full_name: true },
    });
    if (!contact) {
      await ctx.reply("❌ Контакт не найден.");
      return;
    }

    const followups = await prisma.followUp.findMany({
      where: {
        contact_id: contactId,
        OR: [
          { status: "pending" },
          { status: "snoozed", snoozed_until: { lte: new Date() } },
        ],
      },
      orderBy: { due_date: "asc" },
      take: 10,
    });

    if (followups.length === 0) {
      await editOrReply(
        ctx,
        `📋 <b>Follow-ups — ${esc(contact.full_name)}</b>\n${divider()}\n\nНет активных follow-ups.`,
        [
          [Markup.button.callback("➕ Создать", `fu_create:${contactId}`)],
          [Markup.button.callback("← К контакту", `contact_view:${contactId}`)],
        ],
      );
      return;
    }

    const lines = [
      `📋 <b>Follow-ups — ${esc(contact.full_name)}</b>`,
      divider(),
      "",
    ];

    followups.forEach((fu, i) => {
      const { emoji, label } = urgencyBadge(fu.due_date);
      lines.push(`${emoji} ${esc(fu.suggested_action)}`);
      lines.push(`   ${label}`);
      if (i < followups.length - 1) lines.push("");
    });

    // Quick-done buttons row + management
    const doneRow = followups.map((fu, i) =>
      Markup.button.callback(`✅ ${i + 1}`, `fu_done:${fu.id}`),
    );

    const buttons: ReturnType<typeof Markup.button.callback>[][] = [
      doneRow,
      [Markup.button.callback("➕ Создать новый", `fu_create:${contactId}`)],
      [Markup.button.callback("← К контакту", `contact_view:${contactId}`)],
    ];

    await editOrReply(ctx, lines.join("\n"), buttons);
  } catch (err) {
    logger.error("contact followups error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleCreatePrompt(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];

  try {
    await ctx.answerCbQuery();

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { full_name: true },
    });
    if (!contact) {
      await ctx.reply("❌ Контакт не найден.");
      return;
    }

    setState(ctx.chat!.id, "awaiting_fu_text", { contactId });
    await ctx.reply(
      `✏️ Напиши, что нужно сделать для <b>${esc(contact.full_name)}</b>:`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error("fu create prompt error", { error: String(err) });
    await safeAnswer(ctx, "Ошибка");
  }
}

async function handleSetDate(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];
  const days = parseInt(match[2], 10);

  try {
    await ctx.answerCbQuery();

    const chatId = ctx.chat!.id;
    // Retrieve stored action text from state
    const { getState, clearState } = await import("../state");
    const state = getState(chatId);
    if (state?.action !== "awaiting_fu_date" || !state.data.fuText) {
      await ctx.reply("❌ Состояние истекло. Попробуйте создать follow-up заново.");
      return;
    }

    const fuText = state.data.fuText as string;
    clearState(chatId);

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);

    await prisma.followUp.create({
      data: {
        contact_id: contactId,
        suggested_action: fuText,
        due_date: dueDate,
        priority: 5,
      },
    });

    await editOrReply(
      ctx,
      `✅ Follow-up создан!\n📅 Срок: ${fmtDateShort(dueDate)}`,
      [
        [Markup.button.callback("← К контакту", `contact_view:${contactId}`)],
        [Markup.button.callback("📋 Follow-ups", "followups")],
      ],
    );
  } catch (err) {
    logger.error("fu set date error", { error: String(err) });
    await ctx.reply("❌ Не удалось создать follow-up.");
  }
}
