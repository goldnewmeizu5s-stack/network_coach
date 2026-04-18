import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { consolidateAllContacts } from "../services/memory/consolidation";
import { refreshReactionInsights } from "../services/challenge-reactions";

async function main() {
  const startedAt = Date.now();
  logger.info("consolidate-memory: start");

  try {
    const insights = await refreshReactionInsights();
    logger.info("reaction insights", {
      categories: insights.by_category.length,
      loved: insights.loved.length,
      rejected: insights.rejected.length,
    });
  } catch (err) {
    logger.error("refreshReactionInsights failed", { error: String(err) });
  }

  const windowDays = parseInt(process.env.MEMORY_WINDOW_DAYS || "14", 10);
  const limit = parseInt(process.env.MEMORY_LIMIT || "50", 10);
  const delayMs = parseInt(process.env.MEMORY_DELAY_MS || "1500", 10);

  const res = await consolidateAllContacts({ windowDays, limit, delayMs });
  logger.info("consolidate-memory: done", {
    ...res,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
}

main()
  .catch((err) => {
    logger.error("consolidate-memory failed", { error: String(err) });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
