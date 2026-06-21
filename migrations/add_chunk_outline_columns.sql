-- Two-phase notes extraction: Phase 1 reads + persists the Contents/TOC outline for admin
-- review; Phase 2 (real chunk extraction) is gated on chunk_outline_confirmed being true.
-- Run this in the Supabase SQL editor.

alter table source_materials
  add column if not exists chunk_outline jsonb,
  add column if not exists chunk_outline_confirmed boolean not null default false;
