-- ============================================================
-- Sample questions enter the question bank (as drafts)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Sample exam questions were previously used ONLY to write style/difficulty
-- signal onto existing knowledge chunks — the question text itself was
-- discarded after matching. They're useful content in their own right (real
-- exam-style MCQs), so they now also get inserted into the shared
-- `questions` table as drafts, tagged origin='sample_paper' so they're
-- clearly distinguishable from AI-generated ones. They stay invisible to
-- users (status defaults to 'draft') until an admin approves them, same as
-- every other draft question.
-- ============================================================

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS origin TEXT CHECK (origin IN ('ai_generated', 'sample_paper')) DEFAULT 'ai_generated',
  ADD COLUMN IF NOT EXISTS source_material_id UUID REFERENCES source_materials(id) ON DELETE SET NULL,
  -- A sample question can genuinely test more than one knowledge chunk at once.
  -- knowledge_chunk_id holds the primary match; any further chunks it also tests go here.
  ADD COLUMN IF NOT EXISTS additional_chunk_ids UUID[] DEFAULT '{}',
  -- True when the question couldn't be matched to ANY existing chunk — surfaced to the
  -- admin as a flag to review/tag manually, instead of being silently dropped or invented.
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_questions_origin ON questions (origin);
CREATE INDEX IF NOT EXISTS idx_questions_source_material ON questions (source_material_id);
