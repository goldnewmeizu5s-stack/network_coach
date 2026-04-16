import { randomUUID } from "crypto";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { embedText } from "./embeddings";

export type MemorySource =
  | "interaction"
  | "challenge"
  | "chat_user"
  | "chat_assistant"
  | "contact_memory";

export interface MemoryUpsert {
  sourceType: MemorySource;
  sourceId: string;
  contactId?: string | null;
  text: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryHit {
  id: string;
  source_type: string;
  source_id: string;
  contact_id: string | null;
  text: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  created_at: Date;
  score: number;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function upsertMemory(params: MemoryUpsert): Promise<void> {
  const text = params.text?.trim();
  if (!text || text.length < 8) return;

  let embedding: number[];
  try {
    embedding = await embedText(text);
  } catch (err) {
    logger.error("memory embed failed", {
      source_type: params.sourceType,
      source_id: params.sourceId,
      error: String(err),
    });
    return;
  }

  const id = randomUUID();
  const tags = params.tags ?? [];
  const metadata = params.metadata ? JSON.stringify(params.metadata) : null;
  const vec = toVectorLiteral(embedding);

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MemoryChunk"
         (id, source_type, source_id, contact_id, text, embedding, tags, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8::jsonb, NOW(), NOW())
       ON CONFLICT (source_type, source_id) DO UPDATE SET
         contact_id = EXCLUDED.contact_id,
         text = EXCLUDED.text,
         embedding = EXCLUDED.embedding,
         tags = EXCLUDED.tags,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      id,
      params.sourceType,
      params.sourceId,
      params.contactId ?? null,
      text,
      vec,
      tags,
      metadata,
    );
  } catch (err) {
    logger.error("memory upsert failed", {
      source_type: params.sourceType,
      source_id: params.sourceId,
      error: String(err),
    });
  }
}

export async function deleteMemoryBySource(
  sourceType: MemorySource,
  sourceId: string,
): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "MemoryChunk" WHERE source_type = $1 AND source_id = $2`,
      sourceType,
      sourceId,
    );
  } catch (err) {
    logger.error("memory delete failed", {
      source_type: sourceType,
      source_id: sourceId,
      error: String(err),
    });
  }
}

export async function deleteMemoryByContact(contactId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "MemoryChunk" WHERE contact_id = $1`,
      contactId,
    );
  } catch (err) {
    logger.error("memory delete by contact failed", {
      contact_id: contactId,
      error: String(err),
    });
  }
}

export interface SearchOpts {
  limit?: number;
  contactId?: string;
  sourceTypes?: MemorySource[];
  minScore?: number;
}

export async function searchMemory(
  query: string,
  opts: SearchOpts = {},
): Promise<MemoryHit[]> {
  const q = query.trim();
  if (!q) return [];

  let embedding: number[];
  try {
    embedding = await embedText(q);
  } catch (err) {
    logger.error("memory search embed failed", { error: String(err) });
    return [];
  }

  const limit = opts.limit ?? 8;
  const minScore = opts.minScore ?? 0.22;
  const vec = toVectorLiteral(embedding);

  const filters: string[] = ["embedding IS NOT NULL"];
  const params: unknown[] = [vec];

  if (opts.contactId) {
    params.push(opts.contactId);
    filters.push(`contact_id = $${params.length}`);
  }
  if (opts.sourceTypes && opts.sourceTypes.length > 0) {
    params.push(opts.sourceTypes);
    filters.push(`source_type = ANY($${params.length}::text[])`);
  }

  params.push(limit);
  const limitIdx = params.length;

  const sql = `
    SELECT id, source_type, source_id, contact_id, text, tags, metadata, created_at,
           1 - (embedding <=> $1::vector) AS score
    FROM "MemoryChunk"
    WHERE ${filters.join(" AND ")}
    ORDER BY embedding <=> $1::vector
    LIMIT $${limitIdx}
  `;

  try {
    const rows = await prisma.$queryRawUnsafe<MemoryHit[]>(sql, ...params);
    return rows.filter((r) => Number(r.score) >= minScore);
  } catch (err) {
    logger.error("memory search failed", { error: String(err) });
    return [];
  }
}
