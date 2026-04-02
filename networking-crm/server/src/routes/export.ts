import { Router } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/export/contacts
router.get("/contacts", async (_req, res, next) => {
  try {
    const contacts = await prisma.contact.findMany({
      include: {
        interactions: { select: { type: true, content: true, ai_summary: true, created_at: true } },
        follow_ups: { select: { suggested_action: true, status: true, due_date: true } },
      },
    });
    res.setHeader("Content-Disposition", "attachment; filename=contacts.json");
    res.json(contacts);
  } catch (err) {
    next(err);
  }
});

// GET /api/export/all
router.get("/all", async (_req, res, next) => {
  try {
    const [contacts, interactions, challenges, methodologies, chatMessages, followUps, user] =
      await Promise.all([
        prisma.contact.findMany(),
        prisma.interaction.findMany(),
        prisma.challenge.findMany(),
        prisma.methodology.findMany(),
        prisma.chatMessage.findMany(),
        prisma.followUp.findMany(),
        prisma.user.findFirst(),
      ]);

    res.setHeader("Content-Disposition", "attachment; filename=crm-export.json");
    res.json({
      exported_at: new Date().toISOString(),
      user,
      contacts,
      interactions,
      challenges,
      methodologies,
      chat_messages: chatMessages,
      follow_ups: followUps,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
