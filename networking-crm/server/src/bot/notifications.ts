import { Markup } from "telegraf";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { getBotInstance } from "./index";
import { esc, dayWord } from "./ui";

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
    // Today's challenge
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const challenge = await prisma.challenge.findFirst({
      where: { date: { gte: todayStart, lt: todayEnd } },
      orderBy: { created_at: "asc" },
      select: { title: true, category: true },
    });

    // Follow-ups
    const now = new Date();
    const [pendingCount, overdueCount, urgent] = await Promise.all([
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
    ]);

    // Streak
    const yearAgo = new Date(Date.now() - 365 * 86400000);
    const completed = await prisma.challenge.findMany({
      where: { status: "completed", date: { gte: yearAgo } },
      select: { date: true },
    });
    const completedDays = new Set(
      completed.map((c: { date: Date }) => c.date.toISOString().slice(0, 10)),
    );
    let streak = 0;
    const streakStart = new Date();
    streakStart.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const day = new Date(streakStart.getTime() - i * 86400000);
      if (completedDays.has(day.toISOString().slice(0, 10))) {
        streak++;
      } else {
        break;
      }
    }

    // Build message
    const lines = ["☀️ <b>Доброе утро!</b>", ""];

    if (challenge) {
      lines.push(`🎯 <b>Челлендж:</b> ${esc(challenge.title)}`);
      lines.push("");
    }

    if (pendingCount > 0) {
      const overdueStr =
        overdueCount > 0 ? ` (${overdueCount} просрочен)` : "";
      lines.push(`📋 Follow-ups: ${pendingCount} активных${overdueStr}`);
    }

    if (urgent?.contact) {
      lines.push(
        `⚡ Срочно: ${esc(urgent.suggested_action)} — ${esc(urgent.contact.full_name)}`,
      );
    }

    if (streak > 0) {
      lines.push("");
      lines.push(`🔥 Streak: ${streak} ${dayWord(streak)}`);
    }

    lines.push("", "Удачного дня! 💪");

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

    if (dueToday.length > 0) {
      const lines = ["⏰ <b>Напоминание</b>", "", "У тебя на сегодня:"];
      for (const fu of dueToday) {
        const name = fu.contact?.full_name || "Контакт";
        lines.push(
          `📌 ${esc(name)} — "${esc(fu.suggested_action)}"`,
        );
      }
      lines.push("", "Начни с одного! 💪");

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("📋 Follow-ups", "followups")],
      ]);

      await sendTelegramNotification(chatId, lines.join("\n"), keyboard);
    }

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

    if (overdue.length > 0) {
      const lines = ["⚠️ <b>Есть просроченные follow-ups</b>", ""];
      for (const fu of overdue) {
        const name = fu.contact?.full_name || "Контакт";
        const days = Math.floor(
          (Date.now() - fu.due_date.getTime()) / 86400000,
        );
        lines.push(
          `🔴 ${esc(name)} — просрочено на ${days} ${dayWord(days)}`,
        );
      }
      lines.push("", "Сделай сейчас или отложи, чтобы не забыть.");

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("📋 Follow-ups", "followups")],
      ]);

      await sendTelegramNotification(chatId, lines.join("\n"), keyboard);
    }

    if (dueToday.length > 0 || overdue.length > 0) {
      logger.info("[notifications] Follow-up reminders sent", {
        dueToday: dueToday.length,
        overdue: overdue.length,
      });
    }
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

    const [followUpsDone, newContacts, challenges, coolingContacts] =
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
      ]);

    const challengesDone = challenges.filter(
      (c: { status: string }) => c.status === "completed",
    ).length;
    const challengesTotal = challenges.length;

    // Streak
    const yearAgo = new Date(Date.now() - 365 * 86400000);
    const completedChallenges = await prisma.challenge.findMany({
      where: { status: "completed", date: { gte: yearAgo } },
      select: { date: true },
    });
    const completedDays = new Set(
      completedChallenges.map((c: { date: Date }) =>
        c.date.toISOString().slice(0, 10),
      ),
    );
    let streak = 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const day = new Date(now.getTime() - i * 86400000);
      if (completedDays.has(day.toISOString().slice(0, 10))) {
        streak++;
      } else {
        break;
      }
    }

    const lines = [
      "📊 <b>Итоги недели</b>",
      "",
      `✅ Follow-ups выполнено: ${followUpsDone}`,
      `👥 Новых контактов: ${newContacts}`,
      `🎯 Челленджей: ${challengesDone}/${challengesTotal}`,
      `🔥 Streak: ${streak} ${dayWord(streak)}`,
    ];

    if (coolingContacts.length > 0) {
      lines.push("", "⚠️ Остывают:");
      for (const c of coolingContacts) {
        const days = c.last_interaction_at
          ? Math.floor(
              (Date.now() - c.last_interaction_at.getTime()) / 86400000,
            )
          : 0;
        lines.push(
          `• ${esc(c.full_name)} (${days} ${dayWord(days)} без контакта)`,
        );
      }
      lines.push("", "Напиши хотя бы одному из них! 💙");
    }

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("👥 Cooling", "contacts_filter:cooling"),
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
}): Promise<void> {
  const chatId = await getAdminChatId();
  if (!chatId) return;

  // Don't check quiet hours for this — it's triggered by user action

  const lines = [
    "✅ <b>Новый контакт из web</b>",
    "",
    `👤 ${esc(contact.full_name)}`,
  ];

  const job = [contact.occupation, contact.company].filter(Boolean).join(" @ ");
  if (job) lines.push(`💼 ${esc(job)}`);
  if (contact.city) lines.push(`📍 ${esc(contact.city)}`);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👤 Открыть", `contact_view:${contact.id}`)],
  ]);

  await sendTelegramNotification(chatId, lines.join("\n"), keyboard);
}
