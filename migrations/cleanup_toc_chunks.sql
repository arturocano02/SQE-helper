-- Run AFTER add_chunk_outline_columns.sql.
-- Deletes the garbage TOC chunks already inserted (source_section starting "CONTENTS >")
-- and resets "FLK1 Summary (2).docx" so its next extraction run starts clean from page 4+,
-- using the new page-number-based filter + two-phase confirm flow instead of the old
-- text-heuristic filter.

delete from knowledge_chunks where source_section ilike 'CONTENTS%';

update source_materials
set
  chunk_status = 'pending',
  chunk_sections_done = 0,
  chunks_extracted = 0,
  chunk_match_unmatched = 0,
  chunk_outline = null,
  chunk_outline_confirmed = false
where file_name = 'FLK1 Summary (2).docx';
