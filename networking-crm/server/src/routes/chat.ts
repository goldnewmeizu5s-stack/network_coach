import path from "path";
import fs from "fs";
import { Router } from "express";
import multer from "multer";
import prisma from "../lib/prisma";
import { chatMessageSchema } from "../lib/validators";
import { processChat } from "../services/chat-service";
import { transcribeAudio } from "../services/transcription";

const router = Router();

// POST /api/chat
router.post("/", async (req, res, next) => {
  try {
    const parsed = chatMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { message, contact_id } = parsed.data;

    const response = await processChat(message, contact_id || undefined);

    res.json({
      response,
      metadata: {
        referenced_contacts: contact_id ? [contact_id] : undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/history
router.get("/history", async (req, res, next) => {
  try {
    const before = req.query.before as string | undefined;

    const where: Record<string, unknown> = {};
    if (before) {
      const cursor = await prisma.chatMessage.findUnique({
        where: { id: before },
        select: { created_at: true },
      });
      if (cursor) {
        where.created_at = { lt: cursor.created_at };
      }
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: 50,
      select: {
        id: true,
        role: true,
        content: true,
        metadata: true,
        created_at: true,
      },
    });

    messages.reverse();
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/history
router.delete("/history", async (_req, res, next) => {
  try {
    await prisma.chatMessage.deleteMany();
    res.json({ cleared: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/voice
const UPLOADS_DIR = path.join(__dirname, "../../uploads");
const voiceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".webm";
      cb(null, `chat-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post("/voice", voiceUpload.single("audio"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No audio file provided" });
      return;
    }

    // Transcribe then delete file
    const transcript = await transcribeAudio(file.path);
    fs.unlink(file.path, () => {});

    const contactId = req.body.contact_id || undefined;
    const response = await processChat(transcript, contactId);

    res.json({ transcript, response });
  } catch (err) {
    next(err);
  }
});

export default router;
