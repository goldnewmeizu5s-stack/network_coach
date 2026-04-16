import prisma from "../lib/prisma";
import { anthropic } from "../lib/ai";
import { config } from "../config";
import { logger } from "../lib/logger";
import {
  buildChatContext,
  buildContactContext,
  buildSemanticMemorySection,
} from "./context-builder";
import {
  getRelevantMethodologies,
  formatMethodologiesForPrompt,
} from "./methodology-retrieval";
import { HUMANIZATION_RULES_SHORT } from "./humanization-prompt";
import { indexChatMessageAsync } from "./memory/memory-indexer";

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

{relevant_memories}

RELEVANT NETWORKING METHODOLOGIES:
{methodologies}

{progress}

RULES:
- When suggesting actions, be SPECIFIC: reference actual contacts, actual details
- When giving advice, cite the methodology or framework you're using
- If the user asks about a specific person, use ALL available data about them
- If suggesting messages to write, provide 2-3 ready-to-send options that sound like a real person wrote them (use contractions, vary sentence length, avoid corporate buzzwords like "leverage"/"comprehensive"/"pivotal", skip em-dashes, add a parenthetical aside, end abruptly)
- If the user seems anxious about networking, acknowledge the feeling first, then provide practical framework
- Keep responses concise but substantive — no fluff

WHEN DRAFTING MESSAGES FOR THE USER TO SEND:
${HUMANIZATION_RULES_SHORT}`;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callClaude(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const backoff = [2000, 5000];
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: config.claudeModel,
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
        logger.error("Claude API failed after 3 attempts", {
          error: String(err),
        });
        throw err;
      }
    }
  }
  throw new Error("Unreachable");
}

function sanitizeChatHistory(
  messages: { role: string; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const result: { role: "user" | "assistant"; content: string }[] = [];

  for (const m of messages) {
    if (!m.content || !m.content.trim()) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    if (result.length > 0 && result[result.length - 1].role === role) {
      result[result.length - 1].content += "\n\n" + m.content;
    } else {
      result.push({ role, content: m.content });
    }
  }

  while (result.length > 0 && result[0].role === "assistant") {
    result.shift();
  }

  return result;
}

function trimMessages(
  messages: { role: "user" | "assistant"; content: string }[],
  maxChars: number,
): typeof messages {
  let total = 0;
  const result: typeof messages = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    total += messages[i].content.length;
    if (total > maxChars) break;
    result.unshift(messages[i]);
  }
  return result;
}

function buildSystemPrompt(
  crmContext: string,
  contactDetail: string,
  methodologiesText: string,
  semanticMemory: string,
): string {
  const sections = crmContext.split("\n\n");
  const findSection = (prefix: string) =>
    sections.find((s) => s.startsWith(prefix)) || "";

  return SYSTEM_PROMPT_TEMPLATE.replace(
    "{user_context}",
    findSection("## USER PROFILE"),
  )
    .replace("{activity_summary}", findSection("## ACTIVITY"))
    .replace("{urgent_followups}", findSection("## URGENT FOLLOW-UPS"))
    .replace("{contact_overview}", findSection("## CONTACTS"))
    .replace(
      "{contact_detail}",
      contactDetail ? `DETAILED CONTACT INFO:\n${contactDetail}` : "",
    )
    .replace("{relevant_memories}", semanticMemory)
    .replace("{methodologies}", methodologiesText)
    .replace("{progress}", findSection("## PROGRESS"));
}

/**
 * Process a chat message through the AI pipeline.
 * Shared by web API and Telegram bot.
 */
export async function processChat(
  message: string,
  contactId?: string,
): Promise<string> {
  // Load chat history
  const history = await prisma.chatMessage.findMany({
    orderBy: { created_at: "desc" },
    take: 20,
    select: { role: true, content: true },
  });
  history.reverse();

  // Build context
  const crmContext = await buildChatContext();

  let contactDetail = "";
  if (contactId) {
    const cc = await buildContactContext(contactId);
    if (cc) contactDetail = cc;
  }

  const methodologies = await getRelevantMethodologies(message, 3);
  const methodologiesText = formatMethodologiesForPrompt(methodologies);

  const semanticMemory = await buildSemanticMemorySection(message, {
    contactId,
    limit: 8,
  });

  const systemPrompt = buildSystemPrompt(
    crmContext,
    contactDetail,
    methodologiesText,
    semanticMemory,
  );

  // Prepare messages
  const claudeMessages = sanitizeChatHistory(history);
  claudeMessages.push({ role: "user", content: message });

  const trimmedSystem =
    systemPrompt.length > 15000 ? systemPrompt.slice(0, 15000) : systemPrompt;
  const trimmedMessages = trimMessages(claudeMessages, 30000);

  let response: string;
  try {
    response = await callClaude(trimmedSystem, trimmedMessages);
  } catch {
    response = "Извини, AI временно недоступен. Попробуй через минуту.";
  }

  // Save messages
  const savedUser = await prisma.chatMessage.create({
    data: {
      role: "user",
      content: message,
      metadata: contactId ? { contact_id: contactId } : undefined,
    },
  });

  const savedAssistant = await prisma.chatMessage.create({
    data: {
      role: "assistant",
      content: response,
      metadata:
        methodologies.length > 0
          ? {
              methodologies_used: methodologies.map((m) => m.title),
              ...(contactId && { contact_id: contactId }),
            }
          : contactId
            ? { contact_id: contactId }
            : undefined,
    },
  });

  indexChatMessageAsync(savedUser.id);
  indexChatMessageAsync(savedAssistant.id);

  return response;
}
