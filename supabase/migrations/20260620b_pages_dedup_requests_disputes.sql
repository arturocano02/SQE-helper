-- ============================================================
-- Page tracking, upload dedup, content requests, chunk disputes
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run — every statement is idempotent.
-- ============================================================

-- 1. FILE-CONTENT DEDUP
-- A sha256 hash of the raw uploaded bytes. Re-uploading the same file is
-- detected here so we never re-extract / re-chunk / risk duplicate chunks.
-- ============================================================
ALTER TABLE source_materials ADD COLUMN IF NOT EXISTS file_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_source_materials_file_hash ON source_materials(file_hash);

-- 2. PAGE-RANGE TRACKING ON KNOWLEDGE CHUNKS
-- Populated for both notes (.docx) and sample-paper (.pdf) extraction modes.
-- Lets a user cross-check a chunk against the physical page in their notes.
-- ============================================================
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS source_page_start INT;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS source_page_end INT;

-- Set true when a user disputes a chunk — surfaced as a review flag in the
-- admin Knowledge Graph page.
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_chunks_needs_review ON knowledge_chunks(needs_review) WHERE needs_review = TRUE;

-- 3. CHUNK DISPUTES VIA THE EXISTING FEEDBACK TABLE
-- A dispute is just feedback that points at a knowledge_chunk_id instead of
-- (or alongside) a question_id.
-- ============================================================
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS knowledge_chunk_id UUID REFERENCES knowledge_chunks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_feedback_chunk_id ON feedback(knowledge_chunk_id) WHERE knowledge_chunk_id IS NOT NULL;

ALTER TYPE feedback_type ADD VALUE IF NOT EXISTS 'chunk_dispute';

-- 4. CONTENT REQUESTS
-- A user picks a topic + content type (mcq/flashcard) and asks the admin to
-- generate more. Shows up as a notification on the admin generate page.
-- ============================================================
CREATE TABLE IF NOT EXISTS content_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  topic_id     UUID REFERENCES topics(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('mcq', 'flashcard')),
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE content_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_requests_insert_own" ON content_requests;
CREATE POLICY "content_requests_insert_own"
  ON content_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "content_requests_select_own" ON content_requests;
CREATE POLICY "content_requests_select_own"
  ON content_requests FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "content_requests_admin_all" ON content_requests;
CREATE POLICY "content_requests_admin_all"
  ON content_requests FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE INDEX IF NOT EXISTS idx_content_requests_status ON content_requests(status);
CREATE INDEX IF NOT EXISTS idx_content_requests_topic ON content_requests(topic_id);
