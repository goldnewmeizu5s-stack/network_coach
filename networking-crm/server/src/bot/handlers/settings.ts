import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { config } from "../../config";
import { setState } from "../state";
import {
  esc,
  dayWord,
  divider,
  thinDivider,
  editOrReply,
  STATUS_EMOJI,
} from "../ui";

const PROFILE_FIELDS: Record<
  string,
  { label: string; dbField: string; emoji: string }
> = {
  name: { label: "Имя", dbField: "name", emoji: "📛" },
  goals: { label: "Цели", dbField: "goals", emoji: "🎯" },
  fears: { label: "Страхи", dbField: "fears", emoji: "😰" },
  strengths: { label: "Сильные стороны", dbField: "strengths", emoji: "💪" },
  weaknesses: { label: "Слабые стороны", dbField: "weaknesses", emoji: "📉" },
};

export function registerSettingsHandlers(bot: Telegraf) {
  bot.action("settings", handleSettingsMenu);
  bot.action("settings_profile", handleProfile);
  bot.action(/^profile_edit:(.+)$/, handleProfileEdit);
  bot.action("profile_cancel", handleProfile);
  bot.action("settings_quiet_hours", handleQuietHours);
  bot.action(/^quiet_set:(\d+):(\d+)$/, handleQuietSet);
  bot.action("quiet_off", handleQuietOff);
  bot.action("settings_stats", handleStats);
  bot.action("settings_export", handleExportMenu);
  bot.action("export_contacts", handleExportContacts);
  bot.action("export_all", handleExportAll);
}

/** Handle profile field text input from text handler */
export async function handleProfileFieldInput(
  ctx: Context,
  field: string,
  value: string,
): Promise<void> {
  const meta = PROFILE_FIELDS[field];
  if (!meta) return;

  try {
    const user = await prisma.user.findFirst();
    if (!user) return;

    await prisma.user.update({
      where: { id: user.id },
      data: { [meta.dbField]: value },
    });

    await ctx.reply(`✅ ${meta.emoji} ${meta.label} обновлено!`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("← К профилю", "settings_profile")],
      ]),
    });
  } catch (err) {
    logger.error("profile update error", { error: String(err) });
    await ctx.reply("❌ Не удалось обновить профиль.");
  }
}

// ── Handlers ──────────────────────────────────────────────

async function handleSettingsMenu(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const text = [
      "<b>настройки</b>",
      "",
      "профиль, данные, поведение бота.",
    ].join("\n");

    await editOrReply(ctx, text, [
      ...(config.webappUrl
        ? [[Markup.button.webApp("\u2699\uFE0F В приложении", `${config.webappUrl}/settings`)]]
        : []),
      [Markup.button.callback("👤 Мой профиль", "settings_profile")],
      [
        Markup.button.callback("🔕 Тихие часы", "settings_quiet_hours"),
        Markup.button.callback("📊 Статистика", "settings_stats"),
      ],
      [Markup.button.callback("📤 Экспорт данных", "settings_export")],
      [Markup.button.callback("🏠 Меню", "main_menu")],
    ]);
  } catch (err) {
    logger.error("settings menu error", { error: String(err) });
  }
}

async function handleProfile(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const user = await prisma.user.findFirst();
    if (!user) {
      await ctx.reply("❌ Профиль не найден.");
      return;
    }

    const lines = [
      "<b>профиль</b>",
      "",
      `имя: ${esc(user.name || "—")}`,
      `цели: ${esc(user.goals || "—")}`,
      `страхи: ${esc(user.fears || "—")}`,
      `сильные: ${esc(user.strengths || "—")}`,
      `слабые: ${esc(user.weaknesses || "—")}`,
      "",
      "<i>AI использует это для персонализации.</i>",
    ];

    await editOrReply(ctx, lines.join("\n"), [
      [
        Markup.button.callback("✏️ Имя", "profile_edit:name"),
        Markup.button.callback("✏️ Цели", "profile_edit:goals"),
      ],
      [
        Markup.button.callback("✏️ Страхи", "profile_edit:fears"),
        Markup.button.callback("✏️ Сильные", "profile_edit:strengths"),
      ],
      [Markup.button.callback("✏️ Слабые", "profile_edit:weaknesses")],
      [Markup.button.callback("← Настройки", "settings")],
    ]);
  } catch (err) {
    logger.error("profile error", { error: String(err) });
  }
}

async function handleProfileEdit(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const field = match[1];
  const meta = PROFILE_FIELDS[field];
  if (!meta) return;

  try {
    await ctx.answerCbQuery();

    const user = await prisma.user.findFirst();
    const currentValue = user ? (user as any)[meta.dbField] || "—" : "—";

    setState(ctx.chat!.id, `awaiting_profile_${field}`, {});

    const text = [
      `✏️ <b>Редактирование: ${meta.label}</b>`,
      divider(),
      "",
      "Сейчас:",
      `<i>${esc(String(currentValue))}</i>`,
      "",
      "Напиши новое значение:",
    ].join("\n");

    await ctx.reply(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Отмена", "profile_cancel")],
      ]),
    });
  } catch (err) {
    logger.error("profile edit error", { error: String(err) });
  }
}

async function handleQuietHours(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const user = await prisma.user.findFirst({ select: { preferences: true } });
    const prefs = (user?.preferences as Record<string, unknown>) || {};
    const qh = (prefs.quiet_hours as { start: number; end: number }) || {
      start: 22,
      end: 8,
    };

    const isOff = qh.start === -1;
    const statusLine = isOff
      ? "Статус: ❌ Выключены\nБот может писать в любое время."
      : `Статус: ✅ Включены\n⏰ ${String(qh.start).padStart(2, "0")}:00 — ${String(qh.end).padStart(2, "0")}:00 (UTC)\n\nВ это время бот не отправляет\nуведомления и напоминания.`;

    const text = [
      "🔕 <b>Тихие часы</b>",
      divider(),
      "",
      statusLine,
    ].join("\n");

    await editOrReply(ctx, text, [
      [
        Markup.button.callback("22–08", "quiet_set:22:8"),
        Markup.button.callback("23–09", "quiet_set:23:9"),
        Markup.button.callback("00–10", "quiet_set:0:10"),
      ],
      [Markup.button.callback("❌ Выключить", "quiet_off")],
      [Markup.button.callback("← Настройки", "settings")],
    ]);
  } catch (err) {
    logger.error("quiet hours error", { error: String(err) });
  }
}

async function handleQuietSet(ctx: Context) {
  const match = (ctx as any).match as RegExpMatchArray;
  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);

  try {
    await ctx.answerCbQuery();
    await updateQuietHours({ start, end });
    await editOrReply(
      ctx,
      `✅ Тихие часы: ${String(start).padStart(2, "0")}:00 — ${String(end).padStart(2, "0")}:00 UTC`,
      [[Markup.button.callback("← Настройки", "settings")]],
    );
  } catch (err) {
    logger.error("quiet set error", { error: String(err) });
  }
}

async function handleQuietOff(ctx: Context) {
  try {
    await ctx.answerCbQuery();
    await updateQuietHours({ start: -1, end: -1 });
    await editOrReply(ctx, "✅ Тихие часы выключены.", [
      [Markup.button.callback("← Настройки", "settings")],
    ]);
  } catch (err) {
    logger.error("quiet off error", { error: String(err) });
  }
}

async function updateQuietHours(qh: {
  start: number;
  end: number;
}): Promise<void> {
  const user = await prisma.user.findFirst();
  if (!user) return;
  const prefs = (user.preferences as Record<string, unknown>) || {};
  await prisma.user.update({
    where: { id: user.id },
    data: { preferences: { ...prefs, quiet_hours: qh } },
  });
}

async function handleStats(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const [
      totalContacts,
      byStatus,
      followupsDoneWeek,
      pendingFollowups,
      avgWarmth,
      neglected,
      weekChallenges,
    ] = await Promise.all([
      prisma.contact.count({
        where: { warmth_status: { not: "archived" } },
      }),
      prisma.contact.groupBy({
        by: ["warmth_status"],
        _count: true,
        where: { warmth_status: { not: "archived" } },
      }),
      prisma.followUp.count({
        where: { status: "done", completed_at: { gte: weekAgo } },
      }),
      prisma.followUp.count({ where: { status: "pending" } }),
      prisma.contact.aggregate({
        _avg: { warmth_score: true },
        where: { warmth_status: { not: "archived" } },
      }),
      prisma.contact.findMany({
        where: {
          warmth_status: { notIn: ["archived", "paused"] },
          last_interaction_at: { lt: thirtyDaysAgo },
        },
        select: { full_name: true, last_interaction_at: true },
        orderBy: { last_interaction_at: { sort: "asc", nulls: "first" } },
        take: 3,
      }),
      prisma.challenge.findMany({
        where: { date: { gte: weekAgo } },
        select: { status: true },
      }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of byStatus) {
      statusMap[row.warmth_status] = row._count;
    }

    const challengesDone = weekChallenges.filter(
      (c: { status: string }) => c.status === "completed",
    ).length;

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

    const avgScore = Math.round(avgWarmth._avg?.warmth_score ?? 0);

    // Compact status line
    const statusParts: string[] = [];
    for (const s of ["new", "warming", "warm", "cooling", "paused"]) {
      const count = statusMap[s] || 0;
      if (count > 0) statusParts.push(`${STATUS_EMOJI[s]} ${count}`);
    }

    const lines = [
      "<b>статистика</b>",
      "",
      `контакты: ${totalContacts}`,
    ];
    if (statusParts.length > 0) {
      lines.push(statusParts.join(" · "));
    }

    lines.push("");
    lines.push(`<b>follow-ups (7 дней)</b>`);
    lines.push(`выполнено: ${followupsDoneWeek} · ожидают: ${pendingFollowups}`);
    lines.push("");
    lines.push(`<b>челленджи (7 дней)</b>`);
    lines.push(`выполнено: ${challengesDone}/${weekChallenges.length}`);
    if (streak > 0) {
      lines.push(`streak: ${streak} ${dayWord(streak)}`);
    }

    lines.push("");
    lines.push(`средний warmth: ${avgScore}/100`);

    if (neglected.length > 0) {
      lines.push("");
      lines.push("<b>забытые контакты</b>");
      for (const c of neglected) {
        const days = c.last_interaction_at
          ? Math.floor(
              (Date.now() - c.last_interaction_at.getTime()) / 86400000,
            )
          : 999;
        lines.push(
          `· ${esc(c.full_name)} — ${days} ${dayWord(days)}`,
        );
      }
    }

    await editOrReply(ctx, lines.join("\n"), [
      [
        Markup.button.callback("← Настройки", "settings"),
        Markup.button.callback("🏠 Меню", "main_menu"),
      ],
    ]);
  } catch (err) {
    logger.error("stats error", { error: String(err) });
    await ctx.reply("❌ Ошибка загрузки статистики.");
  }
}

async function handleExportMenu(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    const text = [
      "📤 <b>Экспорт данных</b>",
      divider(),
      "",
      "Скачай свои данные в формате JSON.",
      "",
      "📇 Контакты — все контакты с историей",
      "   взаимодействий и follow-ups",
      "📦 Все данные — полный бэкап включая",
      "   челленджи, чат и методологии",
    ].join("\n");

    await editOrReply(ctx, text, [
      [
        Markup.button.callback("📇 Контакты", "export_contacts"),
        Markup.button.callback("📦 Все данные", "export_all"),
      ],
      [Markup.button.callback("← Настройки", "settings")],
    ]);
  } catch (err) {
    logger.error("export menu error", { error: String(err) });
  }
}

async function handleExportContacts(ctx: Context) {
  try {
    await ctx.answerCbQuery("📥 Экспортирую...");

    const contacts = await prisma.contact.findMany({
      include: {
        interactions: {
          select: { type: true, content: true, ai_summary: true, created_at: true },
        },
        follow_ups: {
          select: { suggested_action: true, status: true, due_date: true },
        },
      },
    });

    const json = JSON.stringify(contacts, null, 2);
    await ctx.replyWithDocument({
      source: Buffer.from(json, "utf-8"),
      filename: "contacts.json",
    });
    await ctx.reply("✅ Экспорт готов! Файл отправлен выше ⬆️", {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("← Настройки", "settings")],
      ]),
    });
  } catch (err) {
    logger.error("export contacts error", { error: String(err) });
    await ctx.reply("❌ Ошибка экспорта.");
  }
}

async function handleExportAll(ctx: Context) {
  try {
    await ctx.answerCbQuery("📥 Экспортирую...");

    const [contacts, interactions, challenges, methodologies, chatMessages, followUps, user] =
      await Promise.all([
        prisma.contact.findMany(),
        prisma.interaction.findMany(),
        prisma.challenge.findMany(),
        prisma.methodology.findMany(),
        prisma.chatMessage.findMany(),
        prisma.followUp.findMany(),
        prisma.user.findFirst({
          select: {
            id: true,
            name: true,
            goals: true,
            fears: true,
            strengths: true,
            weaknesses: true,
            preferences: true,
            created_at: true,
            updated_at: true,
          },
        }),
      ]);

    const data = {
      exported_at: new Date().toISOString(),
      user,
      contacts,
      interactions,
      challenges,
      methodologies,
      chat_messages: chatMessages,
      follow_ups: followUps,
    };

    const json = JSON.stringify(data, null, 2);
    await ctx.replyWithDocument({
      source: Buffer.from(json, "utf-8"),
      filename: "crm-export.json",
    });
    await ctx.reply("✅ Экспорт готов! Файл отправлен выше ⬆️", {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("← Настройки", "settings")],
      ]),
    });
  } catch (err) {
    logger.error("export all error", { error: String(err) });
    await ctx.reply("❌ Ошибка экспорта.");
  }
}
