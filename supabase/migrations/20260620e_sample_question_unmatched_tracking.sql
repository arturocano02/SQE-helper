-- ============================================================
-- Sample-question match tracking: multi-chunk + unmatched count
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Sample questions are matched against EXISTING knowledge chunks (never
-- create new ones). A single question can legitimately test more than one
-- chunk at once, and some questions won't match anything in the graph yet.
-- This column persists how many questions from a sample-question upload
-- could not be matched to any existing chunk, so the admin sees that number
-- instead of those questions silently disappearing. It survives resumed
-- batches the same way chunks_extracted already does.
-- ============================================================

ALTER TABLE source_materials
  ADD COLUMN IF NOT EXISTS chunk_match_unmatched INT DEFAULT 0;
