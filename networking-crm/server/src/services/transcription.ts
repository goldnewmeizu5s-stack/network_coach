import fs from "fs";
import { openai } from "../lib/ai";
import { logger } from "../lib/logger";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const maxRetries = 3;
  const backoff = [1000, 3000, 9000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const file = fs.createReadStream(filePath);
      const response = await openai.audio.transcriptions.create({
        model: "whisper-1",
        file,
      });
      return response.text;
    } catch (err: unknown) {
      const isLast = attempt === maxRetries - 1;
      if (isLast) throw err;

      const message = err instanceof Error ? err.message : String(err);
      // Don't retry on validation errors
      if (message.includes("Invalid file format") || message.includes("too large")) {
        throw err;
      }

      logger.warn(`Transcription attempt ${attempt + 1} failed, retrying`, { delay: backoff[attempt] });
      await sleep(backoff[attempt]);
    }
  }

  throw new Error("Transcription failed after all retries");
}
