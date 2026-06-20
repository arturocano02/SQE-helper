-- ============================================================
-- Resumable chunk extraction
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Extraction of large source documents (e.g. 100+ pages) now runs in small
-- batches instead of one long-lived request. These columns let the server
-- track exactly how far it got, so a dropped connection (timeout, closed
-- tab, network blip) never loses progress and never causes duplicate chunks
-- on retry — the next request just resumes from chunk_sections_done.
-- ============================================================

ALTER TABLE source_materials
  ADD COLUMN IF NOT EXISTS chunk_sections_done    INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunk_sections_total    INT,
  ADD COLUMN IF NOT EXISTS chunk_status_updated_at TIMESTAMPTZ DEFAULT NOW();
