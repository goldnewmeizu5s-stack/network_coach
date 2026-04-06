import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { config } from "../../config";
import {
  getAllowedTransitions,
  isValidTransition,
  recalcAndAutoStatus,
} from "../../services/warmth";
import { suggestActions, Suggestion } from "../../services/message-drafting";
import { handleReflectionText } from "./challenges";
import { handleChatMessage } from "./chat";
import { handleVoiceCorrectionText, handleSocialsText, handleContactAnswerText, handleTextContactCreation } from "./voice";
import { handleProfileFieldInput } from "./settings";
import { routeCommand } from "../../services/command-router";
import { setState, getState, clearState } from "../state";
import {
  esc,
  relDate,
  fmtDate,
  divider,
  thinDivider,
  progressBar,
  warmthEmoji,
  warmthLabel,
  urgencyBadge,
  fmtError,
  STATUS_EMOJI,
  STATUS_LABEL,
  editOrReply,
} from "../ui";

const PAGE_SIZE = 10;

export function registerContactHandlers(bot: Telegraf) {
  // Menu entry — show filters
  bot.action("contacts", handleContactsMenu);

  // Filter by status
  bot.action(/^contacts_filter:(.+)$/, handleContactsFilter);

  // Pagination
  bot.action(/^contacts_page:(.+):(\d+)$/, handleContactsPage);

  // View contact card
  bot.action(/^contact_view:(.+)$/, handleContactView);

  // Status management
  bot.action(/^contact_status:(.+)$/, handleStatusMenu);
  bot.action(/^contact_set_status:(.+):(.+)$/, handleSetStatus);

  // Add note
  bot.action(/^contact_note:(.+)$/, handleNotePrompt);

  // AI suggest
  bot.action(/^contact_suggest:(.+)$/, handleSuggest);

  // Create follow-up from suggestion
  bot.action(/^fu_from_suggest:(.+):(\d+)$/, handleCreateFollowUp);

  // Archive (delete)
  bot.action(/^contact_delete:(.+)$/, handleArchiveConfirm);
  bot.action(/^contact_archive_yes:(.+)$/, handleArchiveYes);
  bot.action(/^contact_archive_no:(.+)$/, handleArchiveNo);
}

/** Register text handler for notes and contact search */
export function registerTextHandler(bot: Telegraf) {
  bot.on("text", async (ctx, next) => {
    const text = ctx.message.text;

    // Skip commands
    if (text.startsWith("/")) return next();

    try {
    const chatId = ctx.chat.id;
    const state = getState(chatId);

    // AI chat mode — highest priority after commands
    if (state?.action === "ai_chat") {
      await handleChatMessage(ctx, text);
      return;
    }

    // Voice transcript correction — user describes what to fix
    if (state?.action === "voice_editing") {
      await handleVoiceCorrectionText(ctx, text);
      return;
    }

    // Social links collection after contact creation
    if (state?.action === "awaiting_socials") {
      await handleSocialsText(ctx, text);
      return;
    }

    // Follow-up question answer for contact creation
    if (state?.action === "awaiting_contact_answer") {
      await handleContactAnswerText(ctx, text);
      return;
    }


    // Handle awaiting_note state
    if (state?.action === "awaiting_note") {
      clearState(chatId);
      const contactId = state.data.contactId as string;
      try {
        await prisma.interaction.create({
          data: {
            contact_id: contactId,
            type: "note",
            content: text,
          },
        });
        await recalcAndAutoStatus(contactId);
        await ctx.reply("✅ Заметка сохранена!", {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("← К контакту", `contact_view:${contactId}`)],
          ]),
        });
      } catch (err) {
        logger.error("Failed to save note", { error: String(err) });
        await ctx.reply(`❌ Не удалось сохранить заметку:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
      }
      return;
    }

    // Handle awaiting_fu_text state — user typing follow-up action text
    if (state?.action === "awaiting_fu_text") {
      const contactId = state.data.contactId as string;
      setState(chatId, "awaiting_fu_date", { contactId, fuText: text });
      await ctx.reply("📅 Когда выполнить?", {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("Завтра", `fu_set_date:${contactId}:1`),
            Markup.button.callback("3 дня", `fu_set_date:${contactId}:3`),
          ],
          [
            Markup.button.callback("Неделя", `fu_set_date:${contactId}:7`),
            Markup.button.callback("2 недели", `fu_set_date:${contactId}:14`),
          ],
        ]),
      });
      return;
    }

    // Handle awaiting_reflection state — challenge reflection text
    if (state?.action === "awaiting_reflection") {
      clearState(chatId);
      const challengeId = state.data.challengeId as string;
      const rating = state.data.rating as number;
      await handleReflectionText(ctx, challengeId, rating, text);
      return;
    }

    // Handle awaiting_profile_* states
    if (state?.action?.startsWith("awaiting_profile_")) {
      const field = state.action.replace("awaiting_profile_", "");
      clearState(chatId);
      await handleProfileFieldInput(ctx, field, text);
      return;
    }

    // Smart routing: send any free-form message through AI command router
    await handleSmartMessage(ctx, text);
    } catch (err) {
      logger.error("Text handler error", { error: String(err) });
      await ctx.reply(`⚠️ Ошибка:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" }).catch(() => {});
    }
  });
}

// ── Smart message routing via AI ─────────────────────────

export async function handleSmartMessage(ctx: Context, text: string) {
  try {
    await ctx.sendChatAction("typing");

    const response = await routeCommand(text);
    const { markdownToTelegramHtml } = await import("../ui");
    const sanitized = markdownToTelegramHtml(response);

    // Split long messages
    const TG_LIMIT = 4096;
    const framed = `🤖 ${sanitized}`;

    if (framed.length <= TG_LIMIT) {
      await ctx.reply(framed, { parse_mode: "HTML" });
    } else {
      // Simple split on paragraph boundaries
      let remaining = framed;
      while (remaining.length > 0) {
        if (remaining.length <= TG_LIMIT) {
          await ctx.reply(remaining, { parse_mode: "HTML" });
          break;
        }
        let splitAt = remaining.lastIndexOf("\n\n", TG_LIMIT);
        if (splitAt < TG_LIMIT / 2) splitAt = remaining.lastIndexOf("\n", TG_LIMIT);
        if (splitAt < TG_LIMIT / 4) splitAt = TG_LIMIT;
        await ctx.reply(remaining.slice(0, splitAt).trimEnd(), { parse_mode: "HTML" });
        remaining = remaining.slice(splitAt).trimStart();
      }
    }
  } catch (err) {
    logger.error("Smart message routing error", { error: String(err) });
    await ctx.reply(
      "❌ Не удалось обработать запрос. Попробуй ещё раз или /menu.",
      { parse_mode: "HTML" },
    );
  }
}

// ── Handlers ──────────────────────────────────────────────

async function handleContactsMenu(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const counts = await prisma.contact.groupBy({
      by: ["warmth_status"],
      _count: true,
      where: { warmth_status: { not: "archived" } },
    });

    const countMap: Record<string, number> = {};
    let total = 0;
    for (const row of counts) {
      countMap[row.warmth_status] = row._count;
      total += row._count;
    }

    // Visual summary with mini-bars
    const statuses = ["new", "warming", "warm", "cooling", "paused"] as const;
    const summaryParts: string[] = [];
    for (const s of statuses) {
      const count = countMap[s] || 0;
      if (count > 0) summaryParts.push(`${STATUS_EMOJI[s]} ${count}`);
    }

    const text = [
      `<b>👥 ${total}</b> контактов`,
      "",
      summaryParts.length > 0 ? summaryParts.join(" · ") : "<i>Пока пусто</i>",
    ].join("\n");

    const buttons = [
      [
        btnCompact("🔴", countMap["new"], "contacts_filter:new"),
        btnCompact("🟡", countMap["warming"], "contacts_filter:warming"),
        btnCompact("🟢", countMap["warm"], "contacts_filter:warm"),
      ],
      [
        btnCompact("🟠", countMap["cooling"], "contacts_filter:cooling"),
        btnCompact("⚪", countMap["paused"], "contacts_filter:paused"),
        Markup.button.callback(`📋 Все`, "contacts_filter:all"),
      ],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ];

    await editOrReply(ctx, text, buttons);
  } catch (err) {
    logger.error("contacts menu error", { error: String(err) });
    await ctx.answerCbQuery("Ошибка загрузки").catch(() => {});
  }
}

async function handleContactsFilter(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const status = match[1];
  await showContactsList(ctx, status, 0);
}

async function handleContactsPage(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const status = match[1];
  const offset = parseInt(match[2], 10);
  await showContactsList(ctx, status, offset);
}

async function showContactsList(ctx: Context, status: string, offset: number) {
  try {
    await ctx.answerCbQuery();

    const where =
      status === "all"
        ? { warmth_status: { not: "archived" } }
        : { warmth_status: status };

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { last_interaction_at: { sort: "desc", nulls: "last" } },
        skip: offset,
        take: PAGE_SIZE,
      }),
      prisma.contact.count({ where }),
    ]);

    const statusTitle = STATUS_LABEL[status] || status;

    if (contacts.length === 0) {
      await editOrReply(
        ctx,
        `<b>${statusTitle}</b> · 0\n\n<i>Список пуст</i>`,
        [
          [Markup.button.callback("← Назад", "contacts")],
          [Markup.button.callback("🏠 Меню", "main_menu")],
        ],
      );
      return;
    }

    const pageInfo = total > PAGE_SIZE ? ` · ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}` : "";
    const lines = [
      `<b>${statusTitle}</b> · ${total}${pageInfo}`,
      "",
    ];

    contacts.forEach((c, i) => {
      const emoji = STATUS_EMOJI[c.warmth_status] || "⚪";
      const job = [c.occupation, c.company].filter(Boolean).join(", ");
      const time = relDate(c.last_interaction_at);
      lines.push(`${emoji} <b>${esc(c.full_name)}</b>`);
      if (job) lines.push(`     ${esc(job)}`);
      lines.push(`     <i>${time}</i>`);
      if (i < contacts.length - 1) lines.push("");
    });

    // Each contact as a button row (2 per row for compact layout)
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (let i = 0; i < contacts.length; i += 2) {
      const row: ReturnType<typeof Markup.button.callback>[] = [];
      row.push(
        Markup.button.callback(
          `${STATUS_EMOJI[contacts[i].warmth_status] || "⚪"} ${contacts[i].full_name}`,
          `contact_view:${contacts[i].id}`,
        ),
      );
      if (i + 1 < contacts.length) {
        row.push(
          Markup.button.callback(
            `${STATUS_EMOJI[contacts[i + 1].warmth_status] || "⚪"} ${contacts[i + 1].full_name}`,
            `contact_view:${contacts[i + 1].id}`,
          ),
        );
      }
      buttons.push(row);
    }

    // Pagination + navigation
    const navBtns: ReturnType<typeof Markup.button.callback>[] = [];
    navBtns.push(Markup.button.callback("← Назад", "contacts"));
    if (offset + PAGE_SIZE < total) {
      navBtns.push(
        Markup.button.callback(`Ещё ${Math.min(PAGE_SIZE, total - offset - PAGE_SIZE)}  →`, `contacts_page:${status}:${offset + PAGE_SIZE}`),
      );
    }
    buttons.push(navBtns);
    buttons.push([Markup.button.callback("🏠 Меню", "main_menu")]);

    await editOrReply(ctx, lines.join("\n"), buttons);
  } catch (err) {
    logger.error("contacts list error", { error: String(err) });
    await ctx.answerCbQuery("Ошибка загрузки").catch(() => {});
  }
}

async function handleContactView(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];
  try {
    await ctx.answerCbQuery();
  } catch {
    // not from callback query
  }
  await showContactCard(ctx, contactId);
}

async function showContactCard(ctx: Context, contactId: string) {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        interactions: { orderBy: { created_at: "desc" }, take: 1 },
        follow_ups: { where: { status: "pending" }, take: 3 },
      },
    });

    if (!contact) {
      await ctx.reply("❌ Контакт не найден.", { parse_mode: "HTML" });
      return;
    }

    const score = Math.round(contact.warmth_score);
    const bar = progressBar(score, 100, 10);

    // ── Header ──
    const lines: string[] = [
      `<b>${esc(contact.full_name)}</b>`,
      `${warmthEmoji(contact.warmth_status)} ${warmthLabel(contact.warmth_status)} · ${bar}`,
    ];

    // ── Info block ──
    const infoParts: string[] = [];
    const role = [contact.occupation, contact.company].filter((x): x is string => !!x);
    if (role.length) infoParts.push(`💼 ${role.map(esc).join(", ")}`);
    if (contact.city) infoParts.push(`📍 ${esc(contact.city)}`);
    if (contact.where_met) {
      const metDate = contact.met_date ? `, ${fmtDate(contact.met_date)}` : "";
      infoParts.push(`🤝 ${esc(contact.where_met)}${metDate}`);
    }
    if (infoParts.length) {
      lines.push("");
      lines.push(...infoParts);
    }

    // ── Memory ──
    if (contact.memory_summary) {
      lines.push("");
      lines.push(`💭 <i>${esc(contact.memory_summary)}</i>`);
    }

    // ── Interests ──
    if (contact.key_interests.length > 0) {
      lines.push("");
      const tags = contact.key_interests.map((i) => `#${esc(i.replace(/\s+/g, "_"))}`);
      lines.push(tags.join("  "));
    }

    // ── Personality ──
    if (contact.personality_notes) {
      if (contact.key_interests.length === 0) lines.push("");
      lines.push(`📝 ${esc(contact.personality_notes)}`);
    }

    // ── Social links ──
    const socialLinks = contact.social_links as Record<string, string> | null;
    if (socialLinks && Object.keys(socialLinks).length > 0) {
      lines.push("");
      const platformEmoji: Record<string, string> = {
        telegram: "✈️", whatsapp: "📱", instagram: "📷",
        linkedin: "💼", facebook: "👤", twitter: "🐦",
        phone: "📞", email: "✉️",
      };
      const parts = Object.entries(socialLinks)
        .map(([key, value]) => `${platformEmoji[key] || "🔗"} ${esc(value)}`);
      lines.push(parts.join("  "));
    }

    // ── Stats line ──
    const interactionCount = await prisma.interaction.count({
      where: { contact_id: contactId },
    });
    lines.push("");
    lines.push(`📊 ${interactionCount} взаимодействий · ${relDate(contact.last_interaction_at)}`);

    // ── Follow-ups ──
    if (contact.follow_ups.length > 0) {
      lines.push("");
      lines.push(`📌 <b>Follow-ups</b>`);
      contact.follow_ups.forEach((f) => {
        const badge = f.due_date
          ? ` ${urgencyBadge(f.due_date).emoji}`
          : "";
        lines.push(`  ${badge} ${esc(f.suggested_action)}`);
      });
    }

    const buttons = [
      ...(config.webappUrl
        ? [[Markup.button.webApp("📱 Открыть", `${config.webappUrl}/people/${contactId}`)]]
        : []),
      [
        Markup.button.callback("🎤 Записать", `voice_for:${contactId}`),
        Markup.button.callback("📝 Заметка", `contact_note:${contactId}`),
        Markup.button.callback("💬 Чат", `contact_chat:${contactId}`),
      ],
      [
        Markup.button.callback("🔄 Статус", `contact_status:${contactId}`),
        Markup.button.callback("📋 Follow-ups", `contact_fups:${contactId}`),
        Markup.button.callback("🤖 Совет", `contact_suggest:${contactId}`),
      ],
      [
        Markup.button.callback("← Контакты", "contacts"),
        Markup.button.callback("🏠 Меню", "main_menu"),
      ],
    ];

    await editOrReply(ctx, lines.join("\n"), buttons);
  } catch (err) {
    logger.error("contact card error", { error: String(err), contactId });
    await ctx.reply(`❌ Ошибка загрузки контакта:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

async function handleStatusMenu(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];

  try {
    await ctx.answerCbQuery();

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { full_name: true, warmth_status: true },
    });
    if (!contact) {
      await ctx.reply("❌ Контакт не найден.", { parse_mode: "HTML" });
      return;
    }

    const allowed = getAllowedTransitions(contact.warmth_status);

    const text = [
      `🔄 <b>Статус: ${esc(contact.full_name)}</b>`,
      divider(),
      `Сейчас: ${warmthEmoji(contact.warmth_status)} ${warmthLabel(contact.warmth_status)}`,
      "",
      "Доступные переходы:",
    ].join("\n");

    const buttons = allowed.map((s) => [
      Markup.button.callback(
        `${STATUS_EMOJI[s] || "⚪"} ${STATUS_LABEL[s] || s}`,
        `contact_set_status:${contactId}:${s}`,
      ),
    ]);
    buttons.push([
      Markup.button.callback("📦 Архивировать", `contact_delete:${contactId}`),
    ]);
    buttons.push([
      Markup.button.callback("← К контакту", `contact_view:${contactId}`),
    ]);

    await editOrReply(ctx, text, buttons);
  } catch (err) {
    logger.error("status menu error", { error: String(err) });
    await ctx.answerCbQuery("Ошибка").catch(() => {});
  }
}

async function handleSetStatus(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];
  const newStatus = match[2];

  try {
    await ctx.answerCbQuery();

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { warmth_status: true, full_name: true },
    });
    if (!contact) {
      await ctx.reply("❌ Контакт не найден.", { parse_mode: "HTML" });
      return;
    }

    if (!isValidTransition(contact.warmth_status, newStatus)) {
      await ctx.reply("❌ Недопустимый переход статуса.");
      return;
    }

    await prisma.contact.update({
      where: { id: contactId },
      data: { warmth_status: newStatus },
    });

    await prisma.interaction.create({
      data: {
        contact_id: contactId,
        type: "note",
        content: `Status changed: ${contact.warmth_status} → ${newStatus}`,
      },
    });

    await recalcAndAutoStatus(contactId);

    const emoji = STATUS_EMOJI[newStatus] || "⚪";
    const label = STATUS_LABEL[newStatus] || newStatus;
    await ctx.reply(`✅ Статус изменён на ${emoji} ${label}`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("← К контакту", `contact_view:${contactId}`)],
      ]),
    });
  } catch (err) {
    logger.error("set status error", { error: String(err) });
    await ctx.reply(`❌ Ошибка смены статуса:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

async function handleNotePrompt(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];

  try {
    await ctx.answerCbQuery();

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { full_name: true },
    });
    if (!contact) {
      await ctx.reply("❌ Контакт не найден.", { parse_mode: "HTML" });
      return;
    }

    setState(ctx.chat!.id, "awaiting_note", { contactId });

    await ctx.reply(
      `✏️ Напиши заметку для <b>${esc(contact.full_name)}</b>:`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error("note prompt error", { error: String(err) });
    await ctx.answerCbQuery("Ошибка").catch(() => {});
  }
}

async function handleSuggest(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];

  try {
    await ctx.answerCbQuery();

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { full_name: true },
    });
    if (!contact) {
      await ctx.reply("❌ Контакт не найден.", { parse_mode: "HTML" });
      return;
    }

    const statusMsg = await ctx.reply("🤖 Анализирую...");

    let suggestions: Suggestion[];
    try {
      suggestions = await suggestActions(contactId);
    } catch (err) {
      logger.error("suggest actions failed", { error: String(err) });
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        "❌ Не удалось получить рекомендации.",
      );
      return;
    }

    if (suggestions.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        "🤖 Пока нет рекомендаций для этого контакта.",
      );
      return;
    }

    const urgencyEmoji: Record<string, string> = {
      high: "🔴",
      medium: "🟡",
      low: "🟢",
    };
    const urgencyLabelMap: Record<string, string> = {
      high: "Срочно",
      medium: "Важно",
      low: "Можно позже",
    };

    const lines = [
      `🤖 <b>Рекомендации — ${esc(contact.full_name)}</b>`,
      divider(),
      "",
    ];

    suggestions.forEach((s, i) => {
      const em = urgencyEmoji[s.urgency] || "⚪";
      const label = urgencyLabelMap[s.urgency] || s.urgency;
      lines.push(`${em} <b>${label}</b>`);
      lines.push(esc(s.action));
      if (s.timeframe) lines.push(`⏰ ${esc(s.timeframe)}`);
      if (s.reasoning) lines.push(`<i>${esc(s.reasoning)}</i>`);
      if (i < suggestions.length - 1) {
        lines.push("");
        lines.push(thinDivider());
        lines.push("");
      }
    });

    // Store suggestions for follow-up creation
    setState(ctx.chat!.id, "suggestions", {
      contactId,
      suggestions: suggestions.map((s) => s.action),
    });

    // Truncate action text for button labels (Telegram limit)
    const buttons = suggestions.map((s, i) => {
      const shortAction = s.action.length > 30
        ? s.action.slice(0, 27) + "..."
        : s.action;
      return [
        Markup.button.callback(
          `📋 ${shortAction}`,
          `fu_from_suggest:${contactId}:${i}`,
        ),
      ];
    });
    buttons.push([
      Markup.button.callback("← К контакту", `contact_view:${contactId}`),
    ]);

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      lines.join("\n"),
      { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) },
    );
  } catch (err) {
    logger.error("suggest error", { error: String(err) });
    await ctx.reply(`❌ Ошибка при анализе:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

async function handleCreateFollowUp(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];
  const index = parseInt(match[2], 10);

  try {
    await ctx.answerCbQuery();

    const state = getState(ctx.chat!.id);
    const actions = (state?.data?.suggestions as string[] | undefined) || [];
    const action = actions[index];

    if (!action) {
      await ctx.reply("❌ Рекомендация не найдена. Попробуйте заново.");
      return;
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 2);

    await prisma.followUp.create({
      data: {
        contact_id: contactId,
        suggested_action: action,
        due_date: dueDate,
        priority: 5,
      },
    });

    await ctx.reply("✅ Follow-up создан!", {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("← К контакту", `contact_view:${contactId}`)],
      ]),
    });
  } catch (err) {
    logger.error("create followup error", { error: String(err) });
    await ctx.reply(`❌ Не удалось создать follow-up:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

async function handleArchiveConfirm(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];

  try {
    await ctx.answerCbQuery();

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { full_name: true },
    });
    if (!contact) {
      await ctx.reply("❌ Контакт не найден.", { parse_mode: "HTML" });
      return;
    }

    await editOrReply(
      ctx,
      `📦 Архивировать <b>${esc(contact.full_name)}</b>?\n\nКонтакт будет скрыт из списков.`,
      [
        [
          Markup.button.callback("Да, архивировать", `contact_archive_yes:${contactId}`),
          Markup.button.callback("Отмена", `contact_view:${contactId}`),
        ],
      ],
    );
  } catch (err) {
    logger.error("archive confirm error", { error: String(err) });
    await ctx.answerCbQuery("Ошибка").catch(() => {});
  }
}

async function handleArchiveYes(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];

  try {
    await ctx.answerCbQuery();

    await prisma.contact.update({
      where: { id: contactId },
      data: { warmth_status: "archived" },
    });

    await prisma.interaction.create({
      data: {
        contact_id: contactId,
        type: "note",
        content: "Contact archived via Telegram",
      },
    });

    await editOrReply(ctx, "✅ Контакт архивирован.", [
      [Markup.button.callback("← К контактам", "contacts")],
    ]);
  } catch (err) {
    logger.error("archive error", { error: String(err) });
    await ctx.reply(`❌ Ошибка архивации:\n\n<pre>${fmtError(err)}</pre>`, { parse_mode: "HTML" });
  }
}

async function handleArchiveNo(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const contactId = match[1];
  try {
    await ctx.answerCbQuery();
    await showContactCard(ctx, contactId);
  } catch {
    // ignore
  }
}

// ── Helpers ───────────────────────────────────────────────

function btnCompact(
  emoji: string,
  count: number | undefined,
  callback: string,
) {
  return Markup.button.callback(`${emoji} ${count || 0}`, callback);
}
