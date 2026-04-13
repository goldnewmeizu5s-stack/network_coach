import { Markup } from "telegraf";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { getBotInstance } from "./index";
import { getStreak } from "./keyboards";
import {
  esc,
  dayWord,
  pickRandom,
  dailyVariant,
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
      return hour >= quietHours.start || hour < quietHours.end;
    }
    return hour >= quietHours.start && hour < quietHours.end;
  } catch {
    return false;
  }
}

// ── Morning briefing (redesigned) ────────────────────────
//
// Instead of a dashboard, send ONE focused message in a
// randomly-varied format. The brain can't auto-filter what
// it can't predict.

export async function sendMorningBriefing(): Promise<void> {
  const chatId = await getAdminChatId();
  if (!chatId) return;
  if (await isQuietHours()) return;

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const now = new Date();
    const [challenge, pendingFups, overdueCount, urgent, streak] =
      await Promise.all([
        prisma.challenge.findFirst({
          where: { date: { gte: todayStart, lt: todayEnd } },
          orderBy: { created_at: "asc" },
          select: { id: true, title: true, category: true, difficulty: true, estimated_time_minutes: true },
        }),
        prisma.followUp.findMany({
          where: {
            OR: [
              { status: "pending" },
              { status: "snoozed", snoozed_until: { lte: now } },
            ],
          },
          include: { contact: { select: { full_name: true } } },
          orderBy: { due_date: "asc" },
          take: 3,
        }),
        prisma.followUp.count({
          where: { status: "pending", due_date: { lt: todayStart } },
        }),
        prisma.followUp.findFirst({
          where: {
            status: "pending",
            due_date: { lt: todayStart },
          },
          orderBy: { due_date: "asc" },
          include: { contact: { select: { full_name: true } } },
        }),
        getStreak(),
      ]);

    // Pick a format variant (changes daily so the message looks different each day)
    const variant = dailyVariant(4);
    let text: string;
    let keyboard: ReturnType<typeof Markup.inlineKeyboard>;

    if (variant === 0 && urgent?.contact) {
      // VARIANT 0: "The urgent person" — loss framing, one person
      const name = esc(urgent.contact.full_name);
      const days = Math.floor(
        (Date.now() - urgent.due_date.getTime()) / 86400000,
      );
      const opener = pickRandom([
        `${name} ждёт уже ${days} ${dayWord(days)}.`,
        `Ты откладываешь ${name} уже ${days} ${dayWord(days)}.`,
        `${days} ${dayWord(days)} без ответа для ${name}.`,
      ]);
      const nudge = pickRandom([
        "Одно сообщение. 30 секунд.",
        "Просто напиши. Не надо идеально.",
        "Даже короткое \"привет\" — уже шаг.",
      ]);
      text = `${opener}\n${nudge}`;
      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("Написать", "followups"),
          Markup.button.callback("Не сейчас", "main_menu"),
        ],
      ]);
    } else if (variant === 1 && challenge) {
      // VARIANT 1: "Quick challenge decision" — yes/no, no fluff
      const minutes = challenge.estimated_time_minutes || 10;
      const title = esc(challenge.title);
      const intro = pickRandom([
        `Сегодняшний вызов:`,
        `Вот что на сегодня:`,
        `Задача дня:`,
      ]);
      text = `${intro}\n\n<b>${title}</b>\n~${minutes} мин`;
      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("Берусь", `challenge_accept:${challenge.id}`),
          Markup.button.callback("Что ещё есть?", "challenge_another"),
        ],
      ]);
    } else if (variant === 2 && pendingFups.length > 0) {
      // VARIANT 2: "The count" — create urgency with numbers
      const total = pendingFups.length;
      const names = pendingFups
        .slice(0, 2)
        .map((f: { contact?: { full_name: string } | null }) => esc(f.contact?.full_name || ""))
        .filter(Boolean);
      const nameStr = names.join(", ");

      let countLine: string;
      if (overdueCount > 0) {
        countLine = pickRandom([
          `${overdueCount} человек ждут ответа. ${nameStr} — дольше всех.`,
          `У тебя ${overdueCount} просроченных follow-up. В том числе ${nameStr}.`,
          `${nameStr} — уже просрочено. Всего ${total} в очереди.`,
        ]);
      } else {
        countLine = pickRandom([
          `${total} follow-up на сегодня. Начни с ${nameStr}.`,
          `На сегодня: ${nameStr}${total > 2 ? ` и ещё ${total - 2}` : ""}.`,
          `Сегодня: написать ${nameStr}. Начнёшь?`,
        ]);
      }
      text = countLine;
      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("Открыть", "followups"),
          Markup.button.callback("Потом", "main_menu"),
        ],
      ]);
    } else {
      // VARIANT 3: "Streak + challenge combo" — minimal, punchy
      const parts: string[] = [];
      if (streak > 0) {
        parts.push(pickRandom([
          `${streak} ${dayWord(streak)} подряд.`,
          `Streak: ${streak}. Не ломай.`,
          `${streak}-й день подряд. Продолжай.`,
        ]));
      }
      if (challenge) {
        parts.push(`\nЧеллендж: <b>${esc(challenge.title)}</b>`);
      }
      if (pendingFups.length > 0) {
        parts.push(`Follow-ups: ${pendingFups.length}`);
      }
      if (parts.length === 0) {
        parts.push(pickRandom([
          "Новый день. Кому напишешь сегодня?",
          "Кто из твоих контактов давно не слышал от тебя?",
          "С кем давно не общался?",
        ]));
      }
      text = parts.join("\n");

      const buttons: ReturnType<typeof Markup.button.callback>[] = [];
      if (challenge) buttons.push(Markup.button.callback("Челлендж", "challenge"));
      if (pendingFups.length > 0) buttons.push(Markup.button.callback("Follow-ups", "followups"));
      if (buttons.length === 0) buttons.push(Markup.button.callback("Меню", "main_menu"));
      keyboard = Markup.inlineKeyboard([buttons]);
    }

    await sendTelegramNotification(chatId, text, keyboard);
    logger.info("[notifications] Morning briefing sent (variant " + variant + ")");
  } catch (err) {
    logger.error("Morning briefing failed", { error: String(err) });
  }
}

// ── Follow-up reminders (redesigned) ─────────────────────
//
// Instead of a list/report, send a personal nudge about ONE
// person. Rotate which person is highlighted. Include a
// personal detail to trigger emotional connection.

export async function sendFollowUpReminders(): Promise<void> {
  const chatId = await getAdminChatId();
  if (!chatId) return;
  if (await isQuietHours()) return;

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Get the single most urgent follow-up with contact details
    const mostUrgent = await prisma.followUp.findFirst({
      where: {
        OR: [
          { status: "pending", due_date: { lt: todayStart } },
          { status: "pending", due_date: { gte: todayStart, lt: new Date(todayStart.getTime() + 86400000) } },
        ],
      },
      include: {
        contact: {
          select: {
            full_name: true,
            memory_summary: true,
            last_interaction_at: true,
            key_interests: true,
          },
        },
      },
      orderBy: { due_date: "asc" },
    });

    if (!mostUrgent) return;

    const name = esc(mostUrgent.contact?.full_name || "Контакт");
    const action = esc(mostUrgent.suggested_action);
    const isOverdue = mostUrgent.due_date < todayStart;

    // Build a personal hook — use memory, interests, or time gap
    let personalHook = "";
    if (mostUrgent.contact?.memory_summary) {
      personalHook = `\n<i>${esc(mostUrgent.contact.memory_summary.slice(0, 100))}</i>`;
    } else if (mostUrgent.contact?.last_interaction_at) {
      const days = Math.floor(
        (Date.now() - mostUrgent.contact.last_interaction_at.getTime()) / 86400000,
      );
      if (days > 7) {
        personalHook = `\n<i>Последний контакт: ${days} ${dayWord(days)} назад</i>`;
      }
    }

    // Vary the message format
    let text: string;
    if (isOverdue) {
      const days = Math.floor(
        (Date.now() - mostUrgent.due_date.getTime()) / 86400000,
      );
      text = pickRandom([
        `<b>${name}</b> — ${days} ${dayWord(days)} просрочено.\n${action}${personalHook}`,
        `Ты собирался: ${action}\n<b>${name}</b> ждёт ${days} ${dayWord(days)}.${personalHook}`,
        `${days} дн. назад планировал написать <b>${name}</b>.\n${action}${personalHook}`,
      ]);
    } else {
      text = pickRandom([
        `<b>${name}</b> — на сегодня.\n${action}${personalHook}`,
        `Сегодня: ${action}\nКонтакт: <b>${name}</b>${personalHook}`,
        `Напиши <b>${name}</b> сегодня.\n${action}${personalHook}`,
      ]);
    }

    // Count remaining to create mild urgency
    const totalPending = await prisma.followUp.count({
      where: {
        OR: [
          { status: "pending" },
          { status: "snoozed", snoozed_until: { lte: new Date() } },
        ],
      },
    });

    if (totalPending > 1) {
      text += `\n\n+${totalPending - 1} ещё`;
    }

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("Написать", `fu_draft:${mostUrgent.id}`),
        Markup.button.callback("Готово", `fu_done:${mostUrgent.id}`),
      ],
      [
        Markup.button.callback("Отложить", `fu_snooze:${mostUrgent.id}:2`),
        Markup.button.callback("Все задачи", "followups"),
      ],
    ]);

    await sendTelegramNotification(chatId, text, keyboard);
    logger.info("[notifications] Follow-up reminder sent", {
      contact: mostUrgent.contact?.full_name,
      isOverdue,
    });
  } catch (err) {
    logger.error("Follow-up reminders failed", { error: String(err) });
  }
}

// ── Weekly digest (redesigned) ───────────────────────────
//
// Instead of a stats dashboard, send an honest reflection.
// When activity was low — be direct about it. When it was
// good — genuinely celebrate. Always end with ONE action.

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
          take: 3,
        }),
        getStreak(),
      ]);

    const challengesDone = challenges.filter(
      (c: { status: string }) => c.status === "completed",
    ).length;
    const challengesTotal = challenges.length;
    const totalActivity = followUpsDone + challengesDone + newContacts;

    let text: string;
    let keyboard: ReturnType<typeof Markup.inlineKeyboard>;

    if (totalActivity === 0) {
      // ZERO activity — be honest, no guilt trip, but direct
      const mostNeglected = coolingContacts[0];
      if (mostNeglected) {
        const name = esc(mostNeglected.full_name);
        const days = mostNeglected.last_interaction_at
          ? Math.floor((Date.now() - mostNeglected.last_interaction_at.getTime()) / 86400000)
          : 0;
        text = pickRandom([
          `За эту неделю — ноль активности.\n\n<b>${name}</b> не слышал от тебя ${days} ${dayWord(days)}. Начни с одного человека.`,
          `Эта неделя прошла без нетворкинга.\n\nОдно сообщение для <b>${name}</b> — и ты снова в игре.`,
          `0 follow-ups. 0 челленджей.\n\nНо вот что можно сделать прямо сейчас: написать <b>${name}</b>.`,
        ]);
      } else {
        text = pickRandom([
          "За неделю — тишина. Нетворкинг не работает на паузе.\n\nОдно действие сегодня меняет всё.",
          "Эта неделя прошла мимо. Ничего страшного.\n\nНо следующая начинается сейчас. Одно действие?",
        ]);
      }
      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("Челлендж", "challenge"),
          Markup.button.callback("Follow-ups", "followups"),
        ],
      ]);
    } else if (totalActivity <= 3) {
      // LOW activity — acknowledge effort but push for more
      const lines: string[] = [];
      if (followUpsDone > 0) lines.push(`${followUpsDone} follow-up`);
      if (challengesDone > 0) lines.push(`${challengesDone} челлендж`);
      if (newContacts > 0) lines.push(`${newContacts} новых контактов`);
      const summary = lines.join(" · ");

      text = `Неделя: ${summary}.\n\n`;
      if (coolingContacts.length > 0) {
        const names = coolingContacts.slice(0, 2).map((c: { full_name: string }) => esc(c.full_name)).join(", ");
        text += `${coolingContacts.length} контактов остывают. ${names} — в первую очередь.`;
      } else {
        text += pickRandom([
          "Начало есть. На следующей неделе — больше?",
          "Немного, но не ноль. Можешь больше?",
        ]);
      }
      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("Остывающие", "contacts_filter:cooling"),
          Markup.button.callback("Follow-ups", "followups"),
        ],
      ]);
    } else {
      // GOOD activity — genuine celebration, show growth
      const lines: string[] = [];
      lines.push(pickRandom([
        "Хорошая неделя.",
        "Сильная неделя.",
        "Есть прогресс.",
      ]));
      lines.push("");
      if (followUpsDone > 0) lines.push(`Follow-ups: ${followUpsDone} выполнено`);
      if (challengesDone > 0) lines.push(`Челленджи: ${challengesDone}/${challengesTotal}`);
      if (newContacts > 0) lines.push(`Новые контакты: ${newContacts}`);
      if (streak > 0) lines.push(`Streak: ${streak} ${dayWord(streak)}`);

      if (coolingContacts.length > 0) {
        const name = esc(coolingContacts[0].full_name);
        lines.push(`\nНо <b>${name}</b> остывает. Не забудь.`);
      }

      text = lines.join("\n");
      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("Продолжить", "challenge"),
          Markup.button.callback("Меню", "main_menu"),
        ],
      ]);
    }

    await sendTelegramNotification(chatId, text, keyboard);
    logger.info("[notifications] Weekly digest sent", {
      totalActivity,
      followUpsDone,
      challengesDone,
    });
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

  // Short and personal — not a card, just a confirmation
  const name = esc(contact.full_name);
  const job = [contact.occupation, contact.company].filter(Boolean).join(" @ ");

  let text = `<b>${name}</b> добавлен.`;
  if (job) text += `\n${esc(job)}`;
  if (contact.memory_summary) {
    text += `\n\n<i>${esc(contact.memory_summary.slice(0, 120))}</i>`;
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("Открыть", `contact_view:${contact.id}`),
      Markup.button.callback("Follow-up", `contact_fups:${contact.id}`),
    ],
  ]);

  await sendTelegramNotification(chatId, text, keyboard);
}
