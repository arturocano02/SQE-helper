-- Topics
create table topics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  paper text check (paper in ('FLK1', 'FLK2')) not null,
  slug text unique not null,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- Users (extends Supabase auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  avatar_url text,
  exam_date date,
  is_admin boolean default false,
  onboarding_complete boolean default false,
  created_at timestamptz default now()
);

-- Questions
create table questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references topics(id),
  type text check (type in ('mcq', 'flashcard')) default 'mcq',
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  prompt text not null,
  options jsonb,               -- [{label:'A',text:'...'}, ...] always 5 for MCQ
  correct_answer text,         -- 'A','B','C','D', or 'E'
  explanation text,
  status text check (status in ('draft','approved','archived')) default 'draft',
  source_file text,
  version int default 1,
  created_at timestamptz default now()
);

-- Sessions
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  mode text check (mode in ('drill','simulate','recall')) not null,
  topic_ids uuid[],
  started_at timestamptz default now(),
  ended_at timestamptz,
  paused_at timestamptz,
  current_question_index int default 0,
  question_ids uuid[],           -- ordered list for the session
  total_questions int,
  correct_count int default 0,
  is_complete boolean default false
);

-- Answer history
create table question_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  question_id uuid references questions(id),
  session_id uuid references sessions(id),
  was_correct boolean,
  selected_answer text,
  self_assessment text check (self_assessment in ('got_it','nearly','missed_it')),
  answered_at timestamptz default now(),
  is_imported boolean default false
);

-- Mastery cache (recalculated after each session)
create table user_topic_mastery (
  user_id uuid references profiles(id) on delete cascade,
  topic_id uuid references topics(id),
  mastery_score int default 0,
  easy_correct int default 0, easy_total int default 0,
  medium_correct int default 0, medium_total int default 0,
  hard_correct int default 0, hard_total int default 0,
  last_visited_at timestamptz,
  primary key (user_id, topic_id)
);

-- Spaced repetition state
create table user_question_srs (
  user_id uuid references profiles(id) on delete cascade,
  question_id uuid references questions(id),
  next_review_at timestamptz default now(),
  ease_factor float default 2.5,
  interval_days int default 1,
  repetitions int default 0,
  primary key (user_id, question_id)
);

-- Onboarding coverage
create table user_topic_coverage (
  user_id uuid references profiles(id) on delete cascade,
  topic_id uuid references topics(id),
  confidence text check (confidence in ('shaky','okay','solid')),
  set_at timestamptz default now(),
  primary key (user_id, topic_id)
);

-- Seed topics
insert into topics (name, paper, slug, sort_order) values
('Business Law and Practice',          'FLK1', 'business-law',        1),
('Dispute Resolution',                  'FLK1', 'dispute-resolution',  2),
('Contract',                            'FLK1', 'contract',            3),
('Tort',                                'FLK1', 'tort',                4),
('Legal System and Constitutional Law', 'FLK1', 'legal-system',        5),
('Legal Services',                      'FLK1', 'legal-services',      6),
('Property Practice',                   'FLK2', 'property-practice',   7),
('Land Law',                            'FLK2', 'land-law',            8),
('Trusts',                              'FLK2', 'trusts',              9),
('Wills and Administration of Estates', 'FLK2', 'wills',              10),
('Solicitors Accounts',                 'FLK2', 'solicitors-accounts', 11),
('Criminal Law and Practice',           'FLK2', 'criminal-law',        12);

-- Row-level security
alter table profiles enable row level security;
alter table sessions enable row level security;
alter table question_history enable row level security;
alter table user_topic_mastery enable row level security;
alter table user_question_srs enable row level security;
alter table user_topic_coverage enable row level security;

create policy "Users can read own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users own sessions" on sessions for all using (auth.uid() = user_id);
create policy "Users own history" on question_history for all using (auth.uid() = user_id);
create policy "Users own mastery" on user_topic_mastery for all using (auth.uid() = user_id);
create policy "Users own srs" on user_question_srs for all using (auth.uid() = user_id);
create policy "Users own coverage" on user_topic_coverage for all using (auth.uid() = user_id);
create policy "Anyone reads topics" on topics for select using (true);
create policy "Anyone reads approved questions" on questions for select using (status = 'approved');
create policy "Admins manage questions" on questions for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);
