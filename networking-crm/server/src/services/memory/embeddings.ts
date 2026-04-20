import crypto from "crypto";
import { openai } from "../../lib/ai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;
const MAX_CHARS_PER_INPUT = 8000;

function prep(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS_PER_INPUT);
}

// In-memory LRU cache for embeddings. Embeddings are deterministic for the
// same model + input, so caching avoids re-billing OpenAI for repeated texts
// (common case: same user query re-searching memory, stable contact summaries
// re-embedded during consolidation).
const CACHE_MAX = 1000;
const cache = new Map<string, number[]>();

function hashKey(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function cacheGet(text: string): number[] | undefined {
  const k = hashKey(text);
  const hit = cache.get(k);
  if (hit) {
    // touch for LRU: re-insert at the end of insertion order
    cache.delete(k);
    cache.set(k, hit);
  }
  return hit;
}

function cacheSet(text: string, vec: number[]): void {
  const k = hashKey(text);
  if (cache.has(k)) cache.delete(k);
  cache.set(k, vec);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export async function embedText(text: string): Promise<number[]> {
  const input = prep(text);
  if (!input) return new Array(EMBEDDING_DIM).fill(0);
  const cached = cacheGet(input);
  if (cached) return cached;
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });
  const vec = res.data[0].embedding;
  cacheSet(input, vec);
  return vec;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const prepared = texts.map(prep);
  const result: number[][] = prepared.map(() => new Array(EMBEDDING_DIM).fill(0));
  const missingIdx: number[] = [];
  const missingInputs: string[] = [];
  prepared.forEach((t, i) => {
    if (!t) return;
    const cached = cacheGet(t);
    if (cached) {
      result[i] = cached;
    } else {
      missingIdx.push(i);
      missingInputs.push(t);
    }
  });
  if (missingInputs.length === 0) return result;

  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: missingInputs,
  });
  missingIdx.forEach((origIdx, i) => {
    const vec = res.data[i].embedding;
    result[origIdx] = vec;
    cacheSet(prepared[origIdx], vec);
  });
  return result;
}
