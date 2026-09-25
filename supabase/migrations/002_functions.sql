-- LinkPulse 002: SQL functions.

-- is_admin(): used by RLS policies. SECURITY DEFINER so policies can read profiles without
-- recursive RLS evaluation; search_path pinned so it cannot be hijacked.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin');
$$;

-- my_affiliate_id(): the affiliate the logged-in user belongs to (NULL for admins / anon).
create or replace function public.my_affiliate_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.affiliate_id from public.profiles p where p.user_id = auth.uid() and p.role = 'affiliate';
$$;

-- rollup_hourly(p_since): recompute link_stats_hourly for every hour >= date_trunc('hour', p_since).
-- Idempotent: each hour is recomputed from raw events and upserted, so re-running is harmless.
create or replace function public.rollup_hourly(p_since timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz := date_trunc('hour', p_since);
  v_rows integer;
begin
  with c as (
    select e.link_id,
           date_trunc('hour', e.clicked_at) as hour,
           count(*)::int as clicks,
           count(distinct e.ip_hash)::int as unique_ips,
           (count(*) filter (where e.is_bot is true))::int as bot_clicks,
           (count(*) filter (where e.is_bot is null))::int as unknown_bot_clicks,
           (count(*) filter (where e.country_code is not null and not (e.country_code = any (l.target_countries))))::int as off_target_clicks,
           (count(*) filter (where e.country_code is null))::int as unknown_country_clicks
    from public.click_events e
    join public.links l on l.id = e.link_id
    where e.clicked_at >= v_from
    group by 1, 2
  ),
  v as (
    select link_id,
           date_trunc('hour', occurred_at) as hour,
           (count(*) filter (where type = 'signup'))::int as signups,
           (count(*) filter (where type = 'ftd'))::int as ftds,
           coalesce(sum(amount_usd) filter (where type = 'ftd'), 0)::numeric(12, 2) as deposits_usd
    from public.conversions
    where occurred_at >= v_from
    group by 1, 2
  ),
  merged as (
    select coalesce(c.link_id, v.link_id) as link_id,
           coalesce(c.hour, v.hour) as hour,
           coalesce(c.clicks, 0) as clicks,
           coalesce(c.unique_ips, 0) as unique_ips,
           coalesce(c.bot_clicks, 0) as bot_clicks,
           coalesce(c.unknown_bot_clicks, 0) as unknown_bot_clicks,
           coalesce(c.off_target_clicks, 0) as off_target_clicks,
           coalesce(c.unknown_country_clicks, 0) as unknown_country_clicks,
           coalesce(v.signups, 0) as signups,
           coalesce(v.ftds, 0) as ftds,
           coalesce(v.deposits_usd, 0) as deposits_usd
    from c
    full outer join v on v.link_id = c.link_id and v.hour = c.hour
  )
  insert into public.link_stats_hourly as s
    (link_id, hour, clicks, unique_ips, bot_clicks, unknown_bot_clicks, off_target_clicks,
     unknown_country_clicks, signups, ftds, deposits_usd)
  select * from merged
  on conflict (link_id, hour) do update set
    clicks = excluded.clicks,
    unique_ips = excluded.unique_ips,
    bot_clicks = excluded.bot_clicks,
    unknown_bot_clicks = excluded.unknown_bot_clicks,
    off_target_clicks = excluded.off_target_clicks,
    unknown_country_clicks = excluded.unknown_country_clicks,
    signups = excluded.signups,
    ftds = excluded.ftds,
    deposits_usd = excluded.deposits_usd;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- get_link_window_stats(p_as_of): the raw ingredients of LinkWindowStats for every active,
-- non-loadtest link, computed set-based in one pass over the last 8 days of clicks.
-- Window semantics MUST match src/lib/detection/stats-memory.ts exactly (parity test):
--   age = seconds between clicked_at and p_as_of, only clicks with clicked_at <= p_as_of
--   last10m: age < 600, last60m: age < 3600, last24h: age < 86400,
--   baseline: 86400 <= age < 691200 (the 7 days ending 24 h before p_as_of),
--   hourly history: UTC clock-hour buckets floor(epoch/3600) in [H-168, H-1], H = bucket of p_as_of,
--   current_hour_clicks = clicks in the rolling last 60 minutes (same as last60m.clicks).
--   A click counts as a signup if a signup conversion for it occurred at or before p_as_of.
create or replace function public.get_link_window_stats(p_as_of timestamptz)
returns table (
  link_id uuid,
  target_countries text[],
  l10_clicks int,
  l10_top_ip_clicks int,
  l60_clicks int,
  l60_bot_clicks int,
  l60_unknown_bot_clicks int,
  l60_off_target_clicks int,
  l60_unknown_country_clicks int,
  l60_top_off_target jsonb,
  l24_clicks int,
  l24_signups int,
  base_clicks int,
  base_signups int,
  history_first_bucket bigint,
  history_last_bucket bigint,
  history jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with lk as (
    select l.id, l.target_countries::text[] as targets
    from public.links l
    where l.is_active and l.purpose <> 'loadtest'
  ),
  sg as (
    select distinct cv.click_id
    from public.conversions cv
    join lk on lk.id = cv.link_id
    where cv.type = 'signup' and cv.occurred_at <= p_as_of
      and cv.occurred_at > p_as_of - interval '9 days'
  ),
  ev as (
    select e.link_id,
           e.ip_hash,
           e.country_code::text as country_code,
           e.is_bot,
           extract(epoch from (p_as_of - e.clicked_at)) as age,
           floor(extract(epoch from e.clicked_at) / 3600)::bigint as bucket,
           (e.country_code is not null and not (e.country_code::text = any (lk.targets))) as off_target,
           (sg.click_id is not null) as signup
    from public.click_events e
    join lk on lk.id = e.link_id
    left join sg on sg.click_id = e.id
    where e.clicked_at <= p_as_of
      and e.clicked_at > p_as_of - interval '8 days'
  ),
  agg as (
    select ev.link_id,
           (count(*) filter (where age < 600))::int as l10_clicks,
           (count(*) filter (where age < 3600))::int as l60_clicks,
           (count(*) filter (where age < 3600 and is_bot is true))::int as l60_bot,
           (count(*) filter (where age < 3600 and is_bot is null))::int as l60_unknown_bot,
           (count(*) filter (where age < 3600 and off_target))::int as l60_off,
           (count(*) filter (where age < 3600 and country_code is null))::int as l60_unknown_country,
           (count(*) filter (where age < 86400))::int as l24_clicks,
           (count(*) filter (where age < 86400 and signup))::int as l24_signups,
           (count(*) filter (where age >= 86400 and age < 691200))::int as base_clicks,
           (count(*) filter (where age >= 86400 and age < 691200 and signup))::int as base_signups
    from ev
    group by ev.link_id
  ),
  top_ip as (
    select x.link_id, max(x.n)::int as top_ip_clicks
    from (select ev.link_id, ev.ip_hash, count(*) as n from ev where age < 600 group by 1, 2) x
    group by x.link_id
  ),
  off_c as (
    select y.link_id,
           jsonb_agg(jsonb_build_object('country_code', y.country_code, 'clicks', y.n)
                     order by y.n desc, y.country_code asc) as top_off
    from (
      select z.*, row_number() over (partition by z.link_id order by z.n desc, z.country_code asc) as rn
      from (select ev.link_id, ev.country_code, count(*)::int as n
            from ev where age < 3600 and off_target group by 1, 2) z
    ) y
    where y.rn <= 3
    group by y.link_id
  ),
  hb as (
    select ev.link_id, ev.bucket, count(*)::int as n
    from ev
    where ev.bucket >= floor(extract(epoch from p_as_of) / 3600)::bigint - 168
      and ev.bucket <= floor(extract(epoch from p_as_of) / 3600)::bigint - 1
    group by 1, 2
  ),
  hist as (
    select hb.link_id,
           min(hb.bucket) as first_bucket,
           max(hb.bucket) as last_bucket,
           jsonb_object_agg(hb.bucket::text, hb.n) as buckets
    from hb
    group by hb.link_id
  )
  select lk.id,
         lk.targets,
         coalesce(a.l10_clicks, 0),
         coalesce(t.top_ip_clicks, 0),
         coalesce(a.l60_clicks, 0),
         coalesce(a.l60_bot, 0),
         coalesce(a.l60_unknown_bot, 0),
         coalesce(a.l60_off, 0),
         coalesce(a.l60_unknown_country, 0),
         coalesce(o.top_off, '[]'::jsonb),
         coalesce(a.l24_clicks, 0),
         coalesce(a.l24_signups, 0),
         coalesce(a.base_clicks, 0),
         coalesce(a.base_signups, 0),
         h.first_bucket,
         floor(extract(epoch from p_as_of) / 3600)::bigint - 1,
         coalesce(h.buckets, '{}'::jsonb)
  from lk
  left join agg a on a.link_id = lk.id
  left join top_ip t on t.link_id = lk.id
  left join off_c o on o.link_id = lk.id
  left join hist h on h.link_id = lk.id;
$$;

-- rls_status(): used by scripts/validate.ts (service role only) to prove RLS is on everywhere.
create or replace function public.rls_status()
returns table (table_name text, rls_enabled boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.relname::text, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by 1;
$$;

-- Privileged functions: only the service role (server) may execute them.
revoke execute on function public.rollup_hourly(timestamptz) from public, anon, authenticated;
revoke execute on function public.get_link_window_stats(timestamptz) from public, anon, authenticated;
revoke execute on function public.rls_status() from public, anon, authenticated;
grant execute on function public.rollup_hourly(timestamptz) to service_role;
grant execute on function public.get_link_window_stats(timestamptz) to service_role;
grant execute on function public.rls_status() to service_role;
