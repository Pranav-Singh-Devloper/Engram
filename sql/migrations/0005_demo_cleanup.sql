-- Demo cleanup (SPEC §6.4, §11): expired demo namespaces are deleted with
-- everything in them (every table cascades from namespaces). `now` is a
-- parameter so tests can drive it; pg_cron schedules it when hosted
-- (supabase/hosted/0002_cron_schedules.sql).
create or replace function engram.engram_cleanup_demo(p_now timestamptz)
returns integer
language sql
as $$
  with gone as (
    delete from engram.namespaces
    where kind = 'demo' and expires_at is not null and expires_at <= p_now
    returning 1
  )
  select count(*)::int from gone;
$$;
