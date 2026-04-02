import path from "path";
import { Router } from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { chatMessageSchema } from "../lib/validators";
import { buildChatContext, buildContactContext } from "../services/context-builder";
import {
  getRelevantMethodologies,
  formatMethodologiesForPrompt,
} from "../services/methodology-retrieval";
import { transcribeAudio } from "../services/transcription";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT_TEMPLATE = `You are a sharp, supportive networking advisor — like a smart friend who's also an expert in relationship building and networking science. You have access to the user's complete networking CRM data.

YOUR PERSONALITY:
- Speak casually but give substantive advice
- Reference specific data (names, dates, details from the CRM)
- Push gently but respect boundaries
- Celebrate small wins genuinely
- Use networking science naturally, not pedantically
- Never guilt-trip
- Be occasionally witty
- If the user writes in Russian, respond in Russian. Match their language.

{user_context}

{activity_summary}

{urgent_followups}

{contact_overview}

{contact_detail}

RELEVANT NETWORKING METHODOLOGIES:
{methodologies}

{progress}

RULES:
- When suggesting actions, be SPECIFIC: reference actual contacts, actual details
- When giving advice, cite the methodology or framework you're using
- If the user asks about a specific person, use ALL available data about them
- If suggesting messages to write, provide 2-3 ready-to-send options
- If the user seems anxious about networking, acknowledge the feeling first, then provide practical framework
- Keep responses concise but substantive — no fluff`;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callClaude(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const backoff = [2000, 5000];
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-20250514",
        max_tokens: 1500,
        system: systemPrompt,
        messages,
      });
      return response.content[0].type === "text"
        ? response.content[0].text
        : "";
    } catch (err) {
      if (attempt < 2) {
        logger.warn(`Claude attempt ${attempt + 1} failed, retrying`);
        await sleep(backoff[attempt]);
      } else {
        logger.error("Claude API failed after 3 attempts", { error: String(err) });
        throw err;
      }
    }
  }
  throw new Error("Unreachable");
}

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

    // a. Load chat history
    const history = await prisma.chatMessage.findMany({
      orderBy: { created_at: "desc" },
      take: 20,
      select: { role: true, content: true },
    });
    history.reverse();

    // b. Build context
    const crmContext = await buildChatContext();

    // c. Contact-specific context
    let contactDetail = "";
    if (contact_id) {
      const cc = await buildContactContext(contact_id);
      if (cc) contactDetail = cc;
    }

    // d. Relevant methodologies
    const methodologies = await getRelevantMethodologies(message, 3);
    const methodologiesText = formatMethodologiesForPrompt(methodologies);

    // e. Build system prompt
    // Split CRM context into sections
    const sections = crmContext.split("\n\n");
    const findSection = (prefix: string) =>
      sections.find((s) => s.startsWith(prefix)) || "";

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace("{user_context}", findSection("## USER PROFILE"))
      .replace("{activity_summary}", findSection("## ACTIVITY"))
      .replace("{urgent_followups}", findSection("## URGENT FOLLOW-UPS"))
      .replace("{contact_overview}", findSection("## CONTACTS"))
      .replace(
        "{contact_detail}",
        contactDetail
          ? `DETAILED CONTACT INFO:\n${contactDetail}`
          : ""
      )
      .replace("{methodologies}", methodologiesText)
      .replace("{progress}", findSection("## PROGRESS"));

    // f. Send to Claude
    const claudeMessages: { role: "user" | "assistant"; content: string }[] =
      history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    claudeMessages.push({ role: "user", content: message });

    let response: string;
    try {
      response = await callClaude(systemPrompt, claudeMessages);
    } catch {
      response =
        "Извини, AI временно недоступен. Попробуй через минуту.";
    }

    // g. Save messages
    await prisma.chatMessage.create({
      data: {
        role: "user",
        content: message,
        metadata: contact_id ? { contact_id } : undefined,
      },
    });

    await prisma.chatMessage.create({
      data: {
        role: "assistant",
        content: response,
        metadata: methodologies.length > 0
          ? {
              methodologies_used: methodologies.map((m) => m.title),
              ...(contact_id && { contact_id }),
            }
          : contact_id
            ? { contact_id }
            : undefined,
      },
    });

    // h. Return
    res.json({
      response,
      metadata: {
        referenced_contacts: contact_id ? [contact_id] : undefined,
        methodologies_used:
          methodologies.length > 0
            ? methodologies.map((m) => m.title)
            : undefined,
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

    // Transcribe
    const transcript = await transcribeAudio(file.path);

    // Process as chat message
    const contactId = req.body.contact_id || null;

    // Load context
    const crmContext = await buildChatContext();
    let contactDetail = "";
    if (contactId) {
      const cc = await buildContactContext(contactId);
      if (cc) contactDetail = cc;
    }

    const methodologies = await getRelevantMethodologies(transcript, 2);
    const methodologiesText = formatMethodologiesForPrompt(methodologies);

    const sections = crmContext.split("\n\n");
    const findSection = (prefix: string) =>
      sections.find((s) => s.startsWith(prefix)) || "";

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace("{user_context}", findSection("## USER PROFILE"))
      .replace("{activity_summary}", findSection("## ACTIVITY"))
      .replace("{urgent_followups}", findSection("## URGENT FOLLOW-UPS"))
      .replace("{contact_overview}", findSection("## CONTACTS"))
      .replace(
        "{contact_detail}",
        contactDetail
          ? `DETAILED CONTACT INFO:\n${contactDetail}`
          : ""
      )
      .replace("{methodologies}", methodologiesText)
      .replace("{progress}", findSection("## PROGRESS"));

    // Load recent history
    const history = await prisma.chatMessage.findMany({
      orderBy: { created_at: "desc" },
      take: 10,
      select: { role: true, content: true },
    });
    history.reverse();

    const claudeMessages: { role: "user" | "assistant"; content: string }[] =
      history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    claudeMessages.push({ role: "user", content: transcript });

    let response: string;
    try {
      response = await callClaude(systemPrompt, claudeMessages);
    } catch {
      response = "Извини, AI временно недоступен. Попробуй через минуту.";
    }

    // Save
    await prisma.chatMessage.create({
      data: { role: "user", content: transcript },
    });
    await prisma.chatMessage.create({
      data: { role: "assistant", content: response },
    });

    res.json({ transcript, response });
  } catch (err) {
    next(err);
  }
});

export default router;
