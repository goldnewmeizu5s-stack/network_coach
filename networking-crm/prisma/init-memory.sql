-- Semantic memory storage for the coach (Stage 1).
-- Runs before `prisma db push` and is fully idempotent.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "MemoryChunk" (
  id           TEXT PRIMARY KEY,
  source_type  TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  contact_id   TEXT,
  text         TEXT NOT NULL,
  embedding    vector(1536),
  tags         TEXT[] NOT NULL DEFAULT '{}',
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_source_unique
  ON "MemoryChunk" (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_memory_contact
  ON "MemoryChunk" (contact_id);

CREATE INDEX IF NOT EXISTS idx_memory_created
  ON "MemoryChunk" (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_embedding_cos
  ON "MemoryChunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
