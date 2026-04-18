import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { alignScoreToStatus } from "../services/warmth";

async function main() {
  const contacts = await prisma.contact.findMany({
    select: { id: true, warmth_status: true, warmth_score: true },
  });

  let fixed = 0;
  for (const c of contacts) {
    const aligned = alignScoreToStatus(c.warmth_score, c.warmth_status);
    if (aligned !== c.warmth_score) {
      await prisma.contact.update({
        where: { id: c.id },
        data: { warmth_score: aligned },
      });
      fixed++;
    }
  }

  logger.info(
    `align-warmth-scores: scanned ${contacts.length}, aligned ${fixed}`,
  );
}

main()
  .catch((err) => {
    logger.error("align-warmth-scores failed", { error: String(err) });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
