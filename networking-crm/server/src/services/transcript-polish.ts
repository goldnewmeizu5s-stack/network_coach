import { anthropic } from "../lib/ai";
import { config } from "../config";
import { logger } from "../lib/logger";

const SYSTEM_PROMPT = `You clean up and polish voice transcripts from speech recognition.

Your task: fix typical speech-to-text errors and return a clean, readable version of the transcript.

Rules:
- Fix misheard words, broken sentences, repeated filler words (ну, эм, типа, то есть)
- Correct obvious errors: wrong names, garbled technical terms, misrecognized words
- Preserve ALL factual content — do not add, remove, or change any meaning
- Keep the same language as the original (usually Russian)
- Make the text flow naturally, as if the person wrote it rather than spoke it
- Keep all details: names, places, companies, dates, interests, personality descriptions
- Return ONLY the cleaned transcript text, no explanations, no markdown`;

export async function polishTranscript(rawTranscript: string): Promise<string> {
  try {
    const message = await anthropic.messages.create({
      model: config.claudeFastModel,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: rawTranscript,
        },
      ],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    if (!text.trim()) {
      logger.warn("Transcript polish returned empty result");
      return rawTranscript;
    }

    return text.trim();
  } catch (err) {
    logger.error("Transcript polish failed, using raw", { error: String(err) });
    return rawTranscript;
  }
}
