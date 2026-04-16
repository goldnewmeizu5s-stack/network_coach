import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import {
  indexInteraction,
  indexChallenge,
  indexChatMessage,
  indexContactMemory,
} from "../services/memory/memory-indexer";

async function main() {
  const startedAt = Date.now();
  logger.info("backfill-memory: start");

  const contacts = await prisma.contact.findMany({ select: { id: true } });
  logger.info(`backfill contacts: ${contacts.length}`);
  let ci = 0;
  for (const c of contacts) {
    await indexContactMemory(c.id);
    if (++ci % 25 === 0) logger.info(`contacts ${ci}/${contacts.length}`);
  }

  const interactions = await prisma.interaction.findMany({
    where: {
      OR: [
        { ai_summary: { not: null } },
        { transcript: { not: null } },
        { content: { not: null } },
      ],
    },
    select: { id: true },
    orderBy: { created_at: "desc" },
  });
  logger.info(`backfill interactions: ${interactions.length}`);
  let ii = 0;
  for (const x of interactions) {
    await indexInteraction(x.id);
    if (++ii % 50 === 0) logger.info(`interactions ${ii}/${interactions.length}`);
  }

  const challenges = await prisma.challenge.findMany({
    where: {
      OR: [
        { reflection: { not: null } },
        { status: "completed" },
        { status: "skipped" },
      ],
    },
    select: { id: true },
    orderBy: { created_at: "desc" },
  });
  logger.info(`backfill challenges: ${challenges.length}`);
  let chi = 0;
  for (const x of challenges) {
    await indexChallenge(x.id);
    if (++chi % 25 === 0) logger.info(`challenges ${chi}/${challenges.length}`);
  }

  const chats = await prisma.chatMessage.findMany({
    select: { id: true },
    orderBy: { created_at: "desc" },
    take: 1000,
  });
  logger.info(`backfill chat messages: ${chats.length}`);
  let cmi = 0;
  for (const m of chats) {
    await indexChatMessage(m.id);
    if (++cmi % 50 === 0) logger.info(`chats ${cmi}/${chats.length}`);
  }

  logger.info(`backfill-memory: done in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

main()
  .catch((err) => {
    logger.error("backfill-memory failed", { error: String(err) });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
