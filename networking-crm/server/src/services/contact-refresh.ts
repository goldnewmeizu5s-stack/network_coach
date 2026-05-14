import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { recalcAndAutoStatus } from "./warmth";
import { recalcAndAutoInterestTier } from "./interest";
import { analyzeAndSaveGrowthEdge } from "./growth-edge";

/**
 * Full-network refresh — walks every contact and re-derives its computed
 * data from the records already stored on the contact (interactions,
 * follow-ups, goals, notes). Useful after shipping a feature that adds new
 * fields: old contacts created before it never got those fields filled.
 *
 * It never resets anything to zero — only recomputes:
 *   - warmth score/status   (pure recompute from interactions)
 *   - interest score/tier   (pure recompute from goals/follow-ups)
 *   - growth edge           (AI; backfilled only when missing)
 *
 * Runs in the background as one sequential pass so it never bursts the AI
 * API; progress is exposed via getRefreshProgress() for the UI to poll.
 */

export interface RefreshProgress {
  running: boolean;
  total: number;
  processed: number;
  failed: number;
  growthEdgesBackfilled: number;
  startedAt: string | null;
  finishedAt: string | null;
}

let progress: RefreshProgress = {
  running: false,
  total: 0,
  processed: 0,
  failed: 0,
  growthEdgesBackfilled: 0,
  startedAt: null,
  finishedAt: null,
};

export function getRefreshProgress(): RefreshProgress {
  return { ...progress };
}

export async function runFullContactRefresh(): Promise<void> {
  if (progress.running) {
    logger.warn("[refresh] Full contact refresh already running, skipping");
    return;
  }

  progress = {
    running: true,
    total: 0,
    processed: 0,
    failed: 0,
    growthEdgesBackfilled: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  logger.info("[refresh] Full contact refresh started");

  try {
    const contacts = await prisma.contact.findMany({
      where: { warmth_status: { not: "archived" } },
      select: {
        id: true,
        growth_edge: { select: { id: true } },
      },
      orderBy: { created_at: "asc" },
    });
    progress.total = contacts.length;

    for (const c of contacts) {
      try {
        await recalcAndAutoStatus(c.id);
        await recalcAndAutoInterestTier(c.id);
        // Backfill the growth edge only when it's missing — the weekly cron
        // already handles staleness, and a contact-level "Пересчитать" button
        // covers forced re-analysis.
        if (!c.growth_edge) {
          await analyzeAndSaveGrowthEdge(c.id);
          progress.growthEdgesBackfilled++;
        }
      } catch (err) {
        progress.failed++;
        logger.error("[refresh] Contact refresh failed", {
          contactId: c.id,
          error: String(err),
        });
      }
      progress.processed++;
    }

    logger.info("[refresh] Full contact refresh complete", {
      total: progress.total,
      processed: progress.processed,
      failed: progress.failed,
      growthEdgesBackfilled: progress.growthEdgesBackfilled,
    });
  } catch (err) {
    logger.error("[refresh] Full contact refresh aborted", {
      error: String(err),
    });
  } finally {
    progress.running = false;
    progress.finishedAt = new Date().toISOString();
  }
}
