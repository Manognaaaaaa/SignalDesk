-- LinkPulse 003: Row Level Security.
-- Deny by default: RLS is enabled on every table and users only get SELECT policies.
-- There are NO insert/update/delete policies for anon or authenticated: every write goes
-- through server code using the service role, after the server re-checks the caller's role.

alter table public.affiliates enable row level security;
alter table public.profiles enable row level security;
alter table public.links enable row level security;
alter table public.click_events enable row level security;
alter table public.conversions enable row level security;
alter table public.link_stats_hourly enable row level security;
alter table public.alerts enable row level security;
alter table public.llm_calls enable row level security;
alter table public.job_runs enable row level security;
alter table public.eval_runs enable row level security;

-- Defence in depth: remove table-level write privileges from client roles entirely.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

-- profiles: own row; admin sees all.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- affiliates: admin all; affiliate only their own row.
drop policy if exists affiliates_select on public.affiliates;
create policy affiliates_select on public.affiliates for select to authenticated
  using (public.is_admin() or id = public.my_affiliate_id());

-- links: admin all; affiliate only their own links.
drop policy if exists links_select on public.links;
create policy links_select on public.links for select to authenticated
  using (public.is_admin() or affiliate_id = public.my_affiliate_id());

-- Link-scoped tables: admin all; affiliate only rows whose link belongs to them.
drop policy if exists click_events_select on public.click_events;
create policy click_events_select on public.click_events for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.links l where l.id = click_events.link_id and l.affiliate_id = public.my_affiliate_id()));

drop policy if exists conversions_select on public.conversions;
create policy conversions_select on public.conversions for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.links l where l.id = conversions.link_id and l.affiliate_id = public.my_affiliate_id()));

drop policy if exists link_stats_hourly_select on public.link_stats_hourly;
create policy link_stats_hourly_select on public.link_stats_hourly for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.links l where l.id = link_stats_hourly.link_id and l.affiliate_id = public.my_affiliate_id()));

drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.links l where l.id = alerts.link_id and l.affiliate_id = public.my_affiliate_id()));

-- Operational tables: admin only.
drop policy if exists llm_calls_select on public.llm_calls;
create policy llm_calls_select on public.llm_calls for select to authenticated using (public.is_admin());

drop policy if exists job_runs_select on public.job_runs;
create policy job_runs_select on public.job_runs for select to authenticated using (public.is_admin());

-- eval_runs: the ONLY anon-readable table. It holds aggregate evaluation metrics only
-- (no PII, no secrets, no raw events) and powers the public /evaluation page.
drop policy if exists eval_runs_select on public.eval_runs;
create policy eval_runs_select on public.eval_runs for select to anon, authenticated using (true);
