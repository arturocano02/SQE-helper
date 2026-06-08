-- Source materials — tracks every file uploaded by admin for question generation
create table source_materials (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_type text not null,            -- 'pdf', 'docx', 'txt'
  raw_text text,                      -- extracted plain text
  status text check (status in ('processing', 'done', 'failed')) default 'processing',
  questions_generated int default 0,
  chunks_processed int default 0,
  total_chunks int default 0,
  error_message text,
  uploaded_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- RLS: only admins can see source materials
alter table source_materials enable row level security;

create policy "Admins manage source materials" on source_materials for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- Add FK-like reference from questions to source_materials
-- (keeping as text slug for flexibility — questions may be manually created)
-- No schema change needed; source_file column already exists on questions table

-- Index for fast lookups
create index source_materials_uploaded_by_idx on source_materials (uploaded_by);
create index source_materials_status_idx on source_materials (status);
