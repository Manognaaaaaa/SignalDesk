-- ONE-OFF CLEANUP (not a migration): removes the previous LinkPulse schema from a Supabase
-- project that is being reused for SignalDesk. Run it ONCE in the SQL editor BEFORE 001_tables.sql.
-- It permanently deletes LinkPulse tables and data. Auth users are NOT touched
-- (delete old demo users in Authentication -> Users if you want).

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('linkpulse-rollup', 'linkpulse-detect');
  end if;
end $$;

drop function if exists public.dashboard_kpis(boolean);
drop function if exists public.hourly_series(int, boolean, uuid);
drop function if exists public.link_summaries(boolean);
drop function if exists public.llm_usage_summary(int);
drop function if exists public.get_link_window_stats(timestamptz);
drop function if exists public.rollup_hourly(timestamptz);
drop function if exists public.rls_status();

drop table if exists public.eval_runs, public.job_runs, public.llm_calls, public.alerts, public.link_stats_hourly,
  public.conversions, public.click_events, public.links, public.profiles, public.affiliates cascade;

drop function if exists public.is_admin();
drop function if exists public.my_affiliate_id();
