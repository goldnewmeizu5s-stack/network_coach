import { anthropic } from "../lib/ai";
import { config } from "../config";
import { logger } from "../lib/logger";

const SYSTEM_PROMPT = `You correct voice transcripts based on user feedback.

You receive:
1. An original transcript (from speech recognition, may have errors)
2. A user correction describing what to fix

Your task: return the CORRECTED full transcript incorporating the user's feedback.

Rules:
- Apply the corrections the user describes
- Keep everything else unchanged
- Fix obvious speech recognition errors if the user hints at them
- Preserve the original language (usually Russian)
- Return ONLY the corrected transcript text, no explanations, no markdown
- If the correction adds new information, integrate it naturally into the transcript`;

export async function correctTranscript(
  originalTranscript: string,
  userCorrection: string,
): Promise<string> {
  const message = await anthropic.messages.create({
    model: config.claudeModel,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          "Оригинальная транскрипция:",
          "---",
          originalTranscript,
          "---",
          "",
          "Что нужно исправить:",
          userCorrection,
        ].join("\n"),
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  if (!text.trim()) {
    logger.warn("Transcript correction returned empty result");
    return originalTranscript;
  }

  return text.trim();
}
