import { Markup } from "telegraf";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { getBotInstance } from "./index";
import { getStreak } from "./keyboards";
import {
  esc,
  dayWord,
  divider,
  thinDivider,
  progressBar,
  difficultyDots,
} from "./ui";

// ── Core send function ────────────────────────────────────

export async function sendTelegramNotification(
  chatId: number,
  text: string,
  keyboard?: ReturnType<typeof Markup.inlineKeyboard>,
): Promise<void> {
  const bot = getBotInstance();
  if (!bot) return;

  try {
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: "HTML",
      ...(keyboard || {}),
    });
  } catch (err) {
    logger.error("Telegram notification failed", {
      chatId: String(chatId),
      error: String(err),
    });
  }
}

// ── Helpers ───────────────────────────────────────────────

export async function getAdminChatId(): Promise<number | null> {
  try {
    const user = await prisma.user.findFirst({
      select: { telegram_chat_id: true, preferences: true },
    });
    if (!user?.telegram_chat_id) return null;
    return parseInt(user.telegram_chat_id, 10) || null;
  } catch {
    return null;
  }
}

async function isQuietHours(): Promise<boolean> {
  try {
    const user = await prisma.user.findFirst({
      select: { preferences: true },
    });
    const prefs = (user?.preferences as Record<string, unknown>) || {};
    const quietHours = (prefs.quiet_hours as { start: number; end: number }) || {
      start: 22,
      end: 8,
    };

    const now = new Date();
    const hour = now.getUTCHours();

    if (quietHours.start > quietHours.end) {
      // Wraps midnight: e.g. 22-08
      return hour >= quietHours.start || hour < quietHours.end;
    }
    return hour >= quietHours.start && hour < quietHours.end;
  } catch {
    return false;
  }
}

// ── Morning briefing ──────────────────────────────────────

export async function sendMorningBriefing(): Promise<void> {
  const chatId = await getAdminChatId();
  if (!chatId) return;
  if (await isQuietHours()) return;

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const now = new Date();
    const [challenge, pendingCount, overdueCount, urgent, streak] =
      await Promise.all([
        prisma.challenge.findFirst({
          where: { date: { gte: todayStart, lt: todayEnd } },
          orderBy: { created_at: "asc" },
          select: { title: true, category: true, difficulty: true },
        }),
        prisma.followUp.count({
          where: {
            OR: [
              { status: "pending" },
              { status: "snoozed", snoozed_until: { lte: now } },
            ],
          },
        }),
        prisma.followUp.count({
          where: { status: "pending", due_date: { lt: todayStart } },
        }),
        prisma.followUp.findFirst({
          where: {
            OR: [
              { status: "pending" },
              { status: "snoozed", snoozed_until: { lte: now } },
            ],
          },
          orderBy: { due_date: "asc" },
          include: { contact: { select: { full_name: true } } },
        }),
        getStreak(),
      ]);

    const lines = [
      "☀️ <b>Доброе утро!</b>",
      divider(),
      "",
    ];

    // Challenge
    if (challenge) {
      lines.push(`🎯 <b>Челлендж:</b> ${esc(challenge.title)}`);
      lines.push(`   ${difficultyDots(challenge.difficulty)} сложность ${challenge.difficulty}/10`);
      lines.push("");
    } else {
      lines.push("🎯 Челлендж ещё не готов");
      lines.push("");
    }

    // Follow-ups
    if (pendingCount > 0) {
      const overdueStr = overdueCount > 0
        ? `\n   ⚠️ ${overdueCount} просроченных!`
        : "";
      lines.push(`📋 <b>Follow-ups:</b> ${pendingCount} активных${overdueStr}`);

      if (urgent?.contact) {
        lines.push(`   ⚡ Срочно: написать ${esc(urgent.contact.full_name)}`);
      }
      lines.push("");
    }

    // Streak
    if (streak > 0) {
      lines.push(`🔥 Streak: ${streak} ${dayWord(streak)}`);
      lines.push("");
    }

    lines.push(thinDivider());
    lines.push("Удачного дня! 💪");

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("🎯 Челлендж", "challenge"),
        Markup.button.callback("📋 Follow-ups", "followups"),
      ],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);

    await sendTelegramNotification(chatId, lines.join("\n"), keyboard);
    logger.info("[notifications] Morning briefing sent");
  } catch (err) {
    logger.error("Morning briefing failed", { error: String(err) });
  }
}

// ── Follow-up reminders ───────────────────────────────────

export async function sendFollowUpReminders(): Promise<void> {
  const chatId = await getAdminChatId();
  if (!chatId) return;
  if (await isQuietHours()) return;

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    // Due today
    const dueToday = await prisma.followUp.findMany({
      where: {
        status: "pending",
        due_date: { gte: todayStart, lt: todayEnd },
      },
      include: { contact: { select: { full_name: true } } },
      take: 5,
    });

    // Overdue > 3 days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const overdue = await prisma.followUp.findMany({
      where: {
        status: "pending",
        due_date: { lt: threeDaysAgo },
      },
      include: { contact: { select: { full_name: true } } },
      orderBy: { due_date: "asc" },
      take: 3,
    });

    // Nothing to send
    if (dueToday.length === 0 && overdue.length === 0) return;

    const lines = [
      "⏰ <b>Напоминание</b>",
      divider(),
      "",
    ];

    // Overdue section
    if (overdue.length > 0) {
      lines.push("🔴 <b>Просрочено:</b>");
      for (const fu of overdue) {
        const name = fu.contact?.full_name || "Контакт";
        const days = Math.floor(
          (Date.now() - fu.due_date.getTime()) / 86400000,
        );
        lines.push(
          `   · ${esc(name)} — ${esc(fu.suggested_action)} (${days} дн.)`,
        );
      }
      lines.push("");
    }

    // Due today section
    if (dueToday.length > 0) {
      lines.push("🟡 <b>На сегодня:</b>");
      for (const fu of dueToday) {
        const name = fu.contact?.full_name || "Контакт";
        lines.push(
          `   · ${esc(name)} — ${esc(fu.suggested_action)}`,
        );
      }
      lines.push("");
    }

    lines.push(thinDivider());
    lines.push("Начни с одного — это уже победа! 💪");

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("📋 К follow-ups", "followups")],
    ]);

    await sendTelegramNotification(chatId, lines.join("\n"), keyboard);
    logger.info("[notifications] Follow-up reminders sent", {
      dueToday: dueToday.length,
      overdue: overdue.length,
    });
  } catch (err) {
    logger.error("Follow-up reminders failed", { error: String(err) });
  }
}

// ── Weekly digest ─────────────────────────────────────────

export async function sendWeeklyDigest(): Promise<void> {
  const chatId = await getAdminChatId();
  if (!chatId) return;
  if (await isQuietHours()) return;

  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000);

    const [followUpsDone, newContacts, challenges, coolingContacts, streak] =
      await Promise.all([
        prisma.followUp.count({
          where: { status: "done", completed_at: { gte: weekAgo } },
        }),
        prisma.contact.count({
          where: { created_at: { gte: weekAgo } },
        }),
        prisma.challenge.findMany({
          where: { date: { gte: weekAgo } },
          select: { status: true },
        }),
        prisma.contact.findMany({
          where: { warmth_status: "cooling" },
          select: { full_name: true, last_interaction_at: true },
          orderBy: { last_interaction_at: "asc" },
          take: 5,
        }),
        getStreak(),
      ]);

    const challengesDone = challenges.filter(
      (c: { status: string }) => c.status === "completed",
    ).length;
    const challengesTotal = challenges.length;

    const lines = [
      "📊 <b>Итоги недели</b>",
      divider(),
      "",
      `✅ Follow-ups: <b>${followUpsDone}</b> выполнено`,
      `👥 Новых контактов: <b>${newContacts}</b>`,
      `🎯 Челленджей: <b>${challengesDone}</b>/${challengesTotal}`,
    ];

    if (streak > 0) {
      lines.push(`🔥 Streak: <b>${streak}</b> ${dayWord(streak)}`);
    }

    if (challengesTotal > 0) {
      lines.push("");
      lines.push(progressBar(challengesDone, challengesTotal) + " челленджей");
    }

    if (coolingContacts.length > 0) {
      lines.push("", thinDivider(), "");
      lines.push("⚠️ <b>Остывают:</b>");
      for (const c of coolingContacts) {
        const days = c.last_interaction_at
          ? Math.floor(
              (Date.now() - c.last_interaction_at.getTime()) / 86400000,
            )
          : 0;
        lines.push(
          `   · ${esc(c.full_name)} — ${days} ${dayWord(days)} без контакта`,
        );
      }
      lines.push("");
      lines.push("<i>💡 Напиши хотя бы одному — 5 минут\nсохранят ценную связь.</i>");
    }

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("🟠 Cooling", "contacts_filter:cooling"),
        Markup.button.callback("📋 Follow-ups", "followups"),
      ],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);

    await sendTelegramNotification(chatId, lines.join("\n"), keyboard);
    logger.info("[notifications] Weekly digest sent");
  } catch (err) {
    logger.error("Weekly digest failed", { error: String(err) });
  }
}

// ── New contact notification (from web) ───────────────────

export async function notifyNewContact(contact: {
  id: string;
  full_name: string;
  occupation?: string | null;
  company?: string | null;
  city?: string | null;
  memory_summary?: string | null;
}): Promise<void> {
  const chatId = await getAdminChatId();
  if (!chatId) return;

  // Don't check quiet hours for this — it's triggered by user action

  const lines = [
    "✅ <b>Новый контакт</b>",
    divider(),
    "",
    `👤 <b>${esc(contact.full_name)}</b>`,
  ];

  const job = [contact.occupation, contact.company].filter(Boolean).join(" @ ");
  if (job) lines.push(`💼 ${esc(job)}`);
  if (contact.city) lines.push(`📍 ${esc(contact.city)}`);

  if (contact.memory_summary) {
    lines.push("");
    lines.push(`💡 <i>${esc(contact.memory_summary)}</i>`);
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("👤 Открыть", `contact_view:${contact.id}`),
      Markup.button.callback("📋 Follow-ups", `contact_fups:${contact.id}`),
    ],
  ]);

  await sendTelegramNotification(chatId, lines.join("\n"), keyboard);
}
