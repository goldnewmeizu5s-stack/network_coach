import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config";

export const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
export const openai = new OpenAI({ apiKey: config.openaiApiKey });

type SystemBlock = Anthropic.TextBlockParam;

// Anthropic prompt caching requires a minimum prefix length (~1024 tokens for
// Opus/Sonnet). Using a 2500-char heuristic: roughly 700-900 tokens of English
// or ~500-700 of Russian, which is close enough — cache misses fall back to
// regular pricing and we still save on retries/hits when the prefix is big.
const CACHE_MIN_CHARS = 2500;

/**
 * Build a system prompt that marks the stable prefix as cacheable (ephemeral,
 * ~5 min TTL). Returns a plain string when the prefix is too short to benefit
 * from caching, so callers don't need to branch.
 */
export function cachedSystem(
  staticPrefix: string,
  dynamicTail?: string,
): string | SystemBlock[] {
  const tail = dynamicTail?.trim() ? dynamicTail : "";
  if (staticPrefix.length < CACHE_MIN_CHARS) {
    return tail ? `${staticPrefix}\n\n${tail}` : staticPrefix;
  }
  const blocks: SystemBlock[] = [
    {
      type: "text",
      text: staticPrefix,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (tail) {
    blocks.push({ type: "text", text: tail });
  }
  return blocks;
}
