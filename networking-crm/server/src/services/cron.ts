import cron from "node-cron";
import prisma from "../lib/prisma";
import { generateFollowUps } from "./followup-engine";
import { personalizeFollowUpText } from "./message-drafting";

export async function runDailyJob(): Promise<void> {
  console.log(`[cron] Running daily job at ${new Date().toISOString()}`);

  try {
    // a. Warmth decay check
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const decayingContacts = await prisma.contact.findMany({
      where: {
        warmth_status: "warm",
        last_interaction_at: { lt: thirtyDaysAgo },
      },
      select: { id: true, full_name: true, warmth_status: true },
    });

    for (const contact of decayingContacts) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { warmth_status: "cooling" },
      });
      await prisma.interaction.create({
        data: {
          contact_id: contact.id,
          type: "note",
          content: `Status auto-changed from warm to cooling (no interaction for 30+ days)`,
        },
      });
      console.log(`[cron] ${contact.full_name}: warm → cooling (decay)`);
    }

    // b. Follow-up generation with AI personalization
    const activeContacts = await prisma.contact.findMany({
      where: { warmth_status: { not: "archived" } },
      select: {
        id: true,
        full_name: true,
        key_interests: true,
        where_met: true,
      },
    });

    let generated = 0;
    for (const contact of activeContacts) {
      const drafts = await generateFollowUps(contact.id);
      for (const draft of drafts) {
        // Try to personalize with AI (falls back to template on error)
        const personalizedAction = await personalizeFollowUpText(
          contact.full_name,
          draft.suggested_action,
          contact.key_interests,
          contact.where_met
        );
        await prisma.followUp.create({
          data: { ...draft, suggested_action: personalizedAction },
        });
        generated++;
      }
    }
    if (generated > 0) {
      console.log(`[cron] Generated ${generated} new follow-ups`);
    }

    // c. Stale follow-ups: overdue by 7+ days → increase priority
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const staleFollowUps = await prisma.followUp.findMany({
      where: {
        status: "pending",
        due_date: { lt: sevenDaysAgo },
      },
      select: { id: true, priority: true },
    });

    for (const fu of staleFollowUps) {
      await prisma.followUp.update({
        where: { id: fu.id },
        data: { priority: Math.min(fu.priority + 2, 10) },
      });
    }
    if (staleFollowUps.length > 0) {
      console.log(
        `[cron] Bumped priority on ${staleFollowUps.length} stale follow-ups`
      );
    }

    console.log(`[cron] Daily job completed`);
  } catch (err) {
    console.error("[cron] Daily job failed:", err);
  }
}

export function startCron(): void {
  // Run daily at 08:00 UTC
  cron.schedule("0 8 * * *", () => {
    runDailyJob().catch((err) => console.error("[cron] Error:", err));
  });
  console.log("[cron] Scheduled daily job at 08:00 UTC");
}
