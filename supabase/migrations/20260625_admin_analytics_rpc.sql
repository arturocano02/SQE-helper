-- Admin analytics RPCs: per-user aggregate stats and daily activity, used by the
-- /admin/users list, /admin/users/[id] detail page, and the dashboard's activity chart.
-- Aggregation is done in SQL (not pulled row-by-row into JS) so this stays fast as
-- question_history/sessions grow. Called only from admin API routes via the service-role
-- client, which already bypasses RLS — SECURITY DEFINER is set anyway so these are safe
-- to expose more broadly later without re-auditing RLS.
--
-- Every table reference is schema-qualified (public.sessions, not sessions) because
-- LANGUAGE SQL function bodies are name-resolved using the SQL editor session's active
-- search_path at CREATE time, not the function's own `SET search_path = public` clause
-- (that only applies once the function is later called) — an unqualified name fails to
-- resolve if the editor session wasn't on the public schema when this ran.

create or replace function admin_user_stats()
returns table (
  user_id uuid,
  sessions_completed bigint,
  questions_answered bigint,
  correct_answered bigint,
  last_active timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    coalesce(s.sessions_completed, 0) as sessions_completed,
    coalesce(h.questions_answered, 0) as questions_answered,
    coalesce(h.correct_answered, 0) as correct_answered,
    greatest(s.last_session, h.last_answer) as last_active
  from public.profiles p
  left join (
    select user_id, count(*) as sessions_completed, max(started_at) as last_session
    from public.sessions
    where is_complete = true
    group by user_id
  ) s on s.user_id = p.id
  left join (
    select
      user_id,
      count(*) as questions_answered,
      count(*) filter (where was_correct = true) as correct_answered,
      max(answered_at) as last_answer
    from public.question_history
    group by user_id
  ) h on h.user_id = p.id;
$$;

-- One row per calendar day over the trailing `days_back` days: how many distinct users
-- answered at least one question that day, and how many answers were given in total.
-- Powers the DAU line chart on the admin dashboard.
create or replace function admin_daily_activity(days_back int default 30)
returns table (
  day date,
  active_users bigint,
  answers bigint
)
language sql
security definer
set search_path = public
as $$
  select
    date_trunc('day', answered_at)::date as day,
    count(distinct user_id) as active_users,
    count(*) as answers
  from public.question_history
  where answered_at >= now() - (days_back || ' days')::interval
  group by 1
  order by 1;
$$;
