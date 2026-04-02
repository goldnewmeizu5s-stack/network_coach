import fs from "fs";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

      console.error(
        `[transcription] attempt ${attempt + 1} failed: ${message}, retrying in ${backoff[attempt]}ms`
      );
      await sleep(backoff[attempt]);
    }
  }

  throw new Error("Transcription failed after all retries");
}
