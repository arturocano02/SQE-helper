-- ============================================================
-- Knowledge Chunks Schema Migration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- 1. SUBTOPICS
-- Explicit taxonomy: topic → subtopics (extracted from doc structure)
-- ============================================================
CREATE TABLE IF NOT EXISTS subtopics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id     UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  sort_order   INT  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (topic_id, slug)
);

-- 2. KNOWLEDGE CHUNKS
-- Atomic legal rules, each sourced from the admin notes
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id           UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  subtopic_id        UUID REFERENCES subtopics(id) ON DELETE SET NULL,
  source_material_id UUID REFERENCES source_materials(id) ON DELETE SET NULL,

  rule_text          TEXT NOT NULL,    -- The self-contained legal rule
  context_text       TEXT,             -- Surrounding passage for question generation context
  source_section     TEXT,             -- e.g. "Business Law > Shareholders > Service Contracts"
  key_terms          TEXT[] DEFAULT '{}'::TEXT[],
  rule_type          TEXT DEFAULT 'general_principle'
                       CHECK (rule_type IN (
                         'definition', 'threshold', 'test',
                         'exception', 'procedure', 'consequence', 'general_principle'
                       )),

  is_approved        BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order         INT     NOT NULL DEFAULT 0,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_topic    ON knowledge_chunks (topic_id);
CREATE INDEX IF NOT EXISTS idx_chunks_subtopic ON knowledge_chunks (subtopic_id);
CREATE INDEX IF NOT EXISTS idx_chunks_approved ON knowledge_chunks (is_approved);
CREATE INDEX IF NOT EXISTS idx_chunks_source   ON knowledge_chunks (source_material_id);

-- 3. ADD CHUNK REFERENCE TO QUESTIONS
-- Nullable — existing questions won't have it; new ones will
-- ============================================================
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS knowledge_chunk_id UUID REFERENCES knowledge_chunks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_questions_chunk ON questions (knowledge_chunk_id);

-- 4. TRACK CHUNK EXTRACTION STATUS ON SOURCE MATERIALS
-- ============================================================
ALTER TABLE source_materials
  ADD COLUMN IF NOT EXISTS chunk_status     TEXT DEFAULT 'pending'
    CHECK (chunk_status IN ('pending', 'extracting', 'extracted', 'failed')),
  ADD COLUMN IF NOT EXISTS chunks_extracted INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunk_error      TEXT;

-- 5. USER CHUNK MASTERY
-- Per (user, chunk) confidence level — updated by both onboarding import and live answers
-- ============================================================
CREATE TABLE IF NOT EXISTS user_chunk_mastery (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  chunk_id          UUID NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,

  confidence_level  TEXT NOT NULL DEFAULT 'unseen'
                      CHECK (confidence_level IN ('unseen', 'shaky', 'okay', 'solid')),

  correct_count     INT NOT NULL DEFAULT 0,
  attempt_count     INT NOT NULL DEFAULT 0,
  last_tested_at    TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_ucm_user  ON user_chunk_mastery (user_id);
CREATE INDEX IF NOT EXISTS idx_ucm_chunk ON user_chunk_mastery (chunk_id);

-- 6. ROW LEVEL SECURITY
-- ============================================================

-- subtopics — public read (like topics)
ALTER TABLE subtopics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subtopics_public_read" ON subtopics;
CREATE POLICY "subtopics_public_read"
  ON subtopics FOR SELECT USING (true);

-- knowledge_chunks — approved chunks public read; all ops for admins
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chunks_public_read" ON knowledge_chunks;
CREATE POLICY "chunks_public_read"
  ON knowledge_chunks FOR SELECT
  USING (is_approved = true);

DROP POLICY IF EXISTS "chunks_admin_all" ON knowledge_chunks;
CREATE POLICY "chunks_admin_all"
  ON knowledge_chunks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- user_chunk_mastery — users own their rows
ALTER TABLE user_chunk_mastery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ucm_user_own" ON user_chunk_mastery;
CREATE POLICY "ucm_user_own"
  ON user_chunk_mastery FOR ALL
  USING (user_id = auth.uid());

-- 7. UPDATED_AT TRIGGER FOR knowledge_chunks
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_chunks_updated_at ON knowledge_chunks;
CREATE TRIGGER knowledge_chunks_updated_at
  BEFORE UPDATE ON knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS user_chunk_mastery_updated_at ON user_chunk_mastery;
CREATE TRIGGER user_chunk_mastery_updated_at
  BEFORE UPDATE ON user_chunk_mastery
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
