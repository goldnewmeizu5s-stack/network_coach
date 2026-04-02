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
  // Check consecutive days with at least 1 follow-up done or contact created
  let streak = 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const dayStart = new Date(now.getTime() - i * 86400000);
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    const [followupsDone, contactsCreated] = await Promise.all([
      prisma.followUp.count({
        where: {
          status: "done",
          completed_at: { gte: dayStart, lt: dayEnd },
        },
      }),
      prisma.contact.count({
        where: { created_at: { gte: dayStart, lt: dayEnd } },
      }),
    ]);

    if (followupsDone > 0 || contactsCreated > 0) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export default router;
