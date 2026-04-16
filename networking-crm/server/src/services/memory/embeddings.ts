import { openai } from "../../lib/ai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;
const MAX_CHARS_PER_INPUT = 8000;

function prep(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS_PER_INPUT);
}

export async function embedText(text: string): Promise<number[]> {
  const input = prep(text);
  if (!input) return new Array(EMBEDDING_DIM).fill(0);
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });
  return res.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const prepared = texts.map(prep);
  const result: number[][] = prepared.map(() => new Array(EMBEDDING_DIM).fill(0));
  const activeIdx: number[] = [];
  const activeInputs: string[] = [];
  prepared.forEach((t, i) => {
    if (t) {
      activeIdx.push(i);
      activeInputs.push(t);
    }
  });
  if (activeInputs.length === 0) return result;

  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: activeInputs,
  });
  activeIdx.forEach((origIdx, i) => {
    result[origIdx] = res.data[i].embedding;
  });
  return result;
}
