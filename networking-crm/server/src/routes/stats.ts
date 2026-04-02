import { Router } from "express";
import prisma from "../lib/prisma";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthAgo = new Date(now.getTime() - 30 * 86400000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    const [
      totalContacts,
      byStatusRaw,
      contactsThisWeek,
      contactsThisMonth,
      followupsDoneThisWeek,
      followupsPending,
      avgScore,
      mostNeglected,
    ] = await Promise.all([
      prisma.contact.count({
        where: { warmth_status: { not: "archived" } },
      }),
      prisma.contact.groupBy({
        by: ["warmth_status"],
        _count: true,
        where: { warmth_status: { not: "archived" } },
      }),
      prisma.contact.count({
        where: { created_at: { gte: weekAgo } },
      }),
      prisma.contact.count({
        where: { created_at: { gte: monthAgo } },
      }),
      prisma.followUp.count({
        where: { status: "done", completed_at: { gte: weekAgo } },
      }),
      prisma.followUp.count({
        where: { status: "pending" },
      }),
      prisma.contact.aggregate({
        _avg: { warmth_score: true },
        where: { warmth_status: { not: "archived" } },
      }),
      prisma.contact.findMany({
        where: {
          warmth_status: { notIn: ["archived", "paused"] },
          last_interaction_at: { lt: thirtyDaysAgo },
        },
        select: {
          id: true,
          full_name: true,
          warmth_status: true,
          last_interaction_at: true,
        },
        orderBy: { last_interaction_at: { sort: "asc", nulls: "first" } },
        take: 3,
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of byStatusRaw) {
      byStatus[row.warmth_status] = row._count;
    }

    // Calculate streak
    const streak = await calculateStreak();

    res.json({
      total_contacts: totalContacts,
      by_status: byStatus,
      contacts_this_week: contactsThisWeek,
      contacts_this_month: contactsThisMonth,
      followups_done_this_week: followupsDoneThisWeek,
      followups_pending: followupsPending,
      avg_warmth_score: Math.round(avgScore._avg.warmth_score ?? 0),
      most_neglected: mostNeglected,
      streak,
    });
  } catch (err) {
    next(err);
  }
});

async function calculateStreak(): Promise<number> {
  const yearAgo = new Date(Date.now() - 365 * 86400000);

  const [doneFUs, createdContacts] = await Promise.all([
    prisma.followUp.findMany({
      where: { status: "done", completed_at: { gte: yearAgo } },
      select: { completed_at: true },
    }),
    prisma.contact.findMany({
      where: { created_at: { gte: yearAgo } },
      select: { created_at: true },
    }),
  ]);

  const activeDays = new Set<string>();
  for (const fu of doneFUs) {
    if (fu.completed_at) activeDays.add(fu.completed_at.toISOString().slice(0, 10));
  }
  for (const c of createdContacts) {
    activeDays.add(c.created_at.toISOString().slice(0, 10));
  }

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const day = new Date(today.getTime() - i * 86400000);
    if (activeDays.has(day.toISOString().slice(0, 10))) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export default router;
