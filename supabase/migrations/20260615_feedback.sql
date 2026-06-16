-- Feedback table (idempotent)

do $$ begin
  create type feedback_type as enum (
    'wrong_answer', 'poor_explanation', 'outdated_law', 'misleading_question',
    'bug', 'feature_request', 'content_request', 'other'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type feedback_status as enum (
    'pending', 'reviewed', 'actioned', 'dismissed'
  );
exception when duplicate_object then null;
end $$;

create table if not exists feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  question_id   uuid references questions(id) on delete set null,
  feedback_type feedback_type not null,
  description   text not null,
  status        feedback_status not null default 'pending',
  admin_note    text,
  created_at    timestamptz not null default now()
);

alter table feedback enable row level security;

do $$ begin
  create policy "Admins can do everything on feedback"
    on feedback for all
    using (
      exists (
        select 1 from profiles where id = auth.uid() and is_admin = true
      )
    );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Authenticated users can submit feedback"
    on feedback for insert
    with check (true);
exception when duplicate_object then null;
end $$;

create index if not exists feedback_status_idx      on feedback(status);
create index if not exists feedback_question_id_idx on feedback(question_id) where question_id is not null;
create index if not exists feedback_created_at_idx  on feedback(created_at desc);
