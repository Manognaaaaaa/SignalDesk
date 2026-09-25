-- LinkPulse 006: read-only dashboard functions.
-- All are SECURITY INVOKER: they run with the caller's privileges, so RLS still decides which
-- links/clicks/alerts are counted (an affiliate only ever aggregates their own rows).
-- Aggregating in SQL keeps payloads tiny and avoids PostgREST's max-rows cap on raw rows.
-- 'loadtest' links are never included; 'replay' links only when the caller asks for them.

-- KPI tiles for the last 24 hours.
create or replace function public.dashboard_kpis(p_include_replay boolean default false)
returns table (clicks_24h int, unique_visitors_24h int, bot_clicks_24h int, signups_24h int, open_alerts int)
language sql
stable
security invoker
set search_path = public
as $$
  with lk as (
    select id from public.links
    where purpose = 'campaign' or (p_include_replay and purpose = 'replay')
  ),
  c as (
    select count(*)::int as n, count(distinct e.ip_hash)::int as u, (count(*) filter (where e.is_bot is true))::int as b
    from public.click_events e
    where e.link_id in (select id from lk) and e.clicked_at > now() - interval '24 hours'
  ),
  s as (
    select count(*)::int as n from public.conversions v
    where v.link_id in (select id from lk) and v.type = 'signup' and v.occurred_at > now() - interval '24 hours'
  ),
  a as (
    select count(*)::int as n from public.alerts x
    where x.link_id in (select id from lk) and x.status = 'open'
  )
  select c.n, c.u, c.b, s.n, a.n from c, s, a;
$$;

-- Hourly series (zero-filled) from the rollup table, for all visible links or one link.
create or replace function public.hourly_series(p_hours int, p_include_replay boolean default false, p_link_id uuid default null)
returns table (hour timestamptz, clicks int, bot_clicks int, signups int)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (select greatest(1, least(p_hours, 720)) as h),
  s as (
    select st.hour, st.clicks, st.bot_clicks, st.signups
    from public.link_stats_hourly st
    join public.links l on l.id = st.link_id
    where (p_link_id is not null and l.id = p_link_id)
       or (p_link_id is null and (l.purpose = 'campaign' or (p_include_replay and l.purpose = 'replay')))
  )
  select gs.hour,
         coalesce(sum(s.clicks), 0)::int,
         coalesce(sum(s.bot_clicks), 0)::int,
         coalesce(sum(s.signups), 0)::int
  from bounds,
       generate_series(date_trunc('hour', now()) - make_interval(hours => bounds.h - 1), date_trunc('hour', now()), interval '1 hour') as gs(hour)
  left join s on s.hour = gs.hour
  group by gs.hour
  order by gs.hour;
$$;

-- One row per visible link with 24 h activity (from rollups) and open alert count.
create or replace function public.link_summaries(p_include_replay boolean default false)
returns table (
  link_id uuid, slug text, campaign_name text, affiliate_name text, purpose text, is_active boolean,
  destination_url text, target_countries text[], clicks_24h int, signups_24h int, open_alerts int, created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select l.id, l.slug, l.campaign_name, af.name, l.purpose, l.is_active, l.destination_url, l.target_countries::text[],
         coalesce(st.clicks, 0)::int, coalesce(st.signups, 0)::int, coalesce(al.n, 0)::int, l.created_at
  from public.links l
  left join public.affiliates af on af.id = l.affiliate_id
  left join (
    select link_id, sum(clicks) as clicks, sum(signups) as signups
    from public.link_stats_hourly
    where hour >= date_trunc('hour', now()) - interval '23 hours'
    group by link_id
  ) st on st.link_id = l.id
  left join (
    select link_id, count(*) as n from public.alerts where status = 'open' group by link_id
  ) al on al.link_id = l.id
  where l.purpose = 'campaign' or (p_include_replay and l.purpose = 'replay')
  order by l.created_at, l.slug;
$$;

-- LLM usage totals for the /system page (llm_calls is admin-only under RLS; others get zeros).
create or replace function public.llm_usage_summary(p_days int default 30)
returns table (calls int, ok_calls int, failed_calls int, input_tokens bigint, output_tokens bigint, est_cost_usd numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::int,
         (count(*) filter (where status = 'ok'))::int,
         (count(*) filter (where status <> 'ok'))::int,
         coalesce(sum(input_tokens), 0)::bigint,
         coalesce(sum(output_tokens), 0)::bigint,
         coalesce(sum(est_cost_usd), 0)::numeric
  from public.llm_calls
  where created_at > now() - make_interval(days => greatest(1, least(p_days, 365)));
$$;

revoke execute on function public.dashboard_kpis(boolean) from public, anon;
revoke execute on function public.hourly_series(int, boolean, uuid) from public, anon;
revoke execute on function public.link_summaries(boolean) from public, anon;
revoke execute on function public.llm_usage_summary(int) from public, anon;
grant execute on function public.dashboard_kpis(boolean) to authenticated, service_role;
grant execute on function public.hourly_series(int, boolean, uuid) to authenticated, service_role;
grant execute on function public.link_summaries(boolean) to authenticated, service_role;
grant execute on function public.llm_usage_summary(int) to authenticated, service_role;
