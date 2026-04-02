import path from "path";
import { Router } from "express";
import multer from "multer";
import prisma from "../lib/prisma";
import { processVoiceNote } from "../services/voice-pipeline";

const UPLOADS_DIR = path.join(__dirname, "../../uploads");
const ALLOWED_EXTENSIONS = [".webm", ".mp4", ".mp3", ".wav", ".ogg"];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".webm";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Allow if extension matches or if no extension (browser-recorded blobs)
    if (!ext || ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file format. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`));
    }
  },
});

const router = Router();

// POST /api/voice/upload
router.post("/upload", upload.single("audio"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No audio file provided" });
      return;
    }

    const durationSeconds = req.body.duration_seconds
      ? parseInt(req.body.duration_seconds, 10)
      : null;

    const contactId = req.body.contact_id || null;

    // Create interaction + audio file records
    const interaction = await prisma.interaction.create({
      data: {
        type: "voice_note",
        content: null,
        ...(contactId && { contact_id: contactId }),
      },
    });

    await prisma.audioFile.create({
      data: {
        interaction_id: interaction.id,
        file_path: file.path,
        duration_seconds: durationSeconds,
        transcription_status: "pending",
      },
    });

    // Return immediately, process async
    res.json({ id: interaction.id, status: "processing" });

    // Fire and forget
    processVoiceNote(interaction.id, file.path).catch((err) => {
      console.error("[voice/upload] pipeline error:", err);
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/voice/:id/status
router.get("/:id/status", async (req, res, next) => {
  try {
    const interaction = await prisma.interaction.findUnique({
      where: { id: req.params.id },
      include: { audio_file: true },
    });

    if (!interaction) {
      res.status(404).json({ error: "Interaction not found" });
      return;
    }

    const status = interaction.audio_file?.transcription_status || "unknown";

    res.json({
      status,
      contact_id: interaction.contact_id,
      transcript: interaction.transcript,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
