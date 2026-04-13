import path from "path";
import { Router } from "express";
import multer from "multer";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { processVoiceNote, processBatchVoiceActivity } from "../services/voice-pipeline";

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
    const mode = req.body.mode || "default"; // "default" | "batch_activity"

    // Create interaction + audio file records
    const interaction = await prisma.interaction.create({
      data: {
        type: mode === "batch_activity" ? "voice_note" : "voice_note",
        content: mode === "batch_activity" ? JSON.stringify({ mode: "batch_activity" }) : null,
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
    res.json({ id: interaction.id, status: "processing", mode });

    // Fire and forget — route to appropriate pipeline
    if (mode === "batch_activity") {
      processBatchVoiceActivity(interaction.id, file.path).catch((err) => {
        logger.error("Batch voice pipeline error", { error: String(err) });
      });
    } else {
      processVoiceNote(interaction.id, file.path).catch((err) => {
        logger.error("Voice pipeline error", { error: String(err) });
      });
    }
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

    // Extract multiple contact IDs and batch results if stored in content field
    let contactIds: string[] = [];
    let batchResult = null;
    let mode = "default";
    if (interaction.contact_id) {
      contactIds.push(interaction.contact_id);
    }
    if (interaction.content) {
      try {
        const parsed = JSON.parse(interaction.content);
        if (parsed?.mode === "batch_activity") {
          mode = "batch_activity";
          if (Array.isArray(parsed?.contact_ids)) {
            contactIds = parsed.contact_ids;
          }
          if (parsed?.result) {
            batchResult = parsed.result;
          }
        } else if (Array.isArray(parsed?.contact_ids)) {
          contactIds = parsed.contact_ids;
        }
      } catch {
        // content is not JSON — that's fine, ignore
      }
    }

    res.json({
      status,
      mode,
      contact_id: interaction.contact_id,
      contact_ids: contactIds.length > 0 ? contactIds : undefined,
      transcript: interaction.transcript,
      ...(batchResult && { batch_result: batchResult }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
