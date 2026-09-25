-- LinkPulse 001: core tables.
-- Every table lives in schema public and gets RLS enabled in 003_rls.sql (deny by default).
-- Raw IPs and full user-agent strings are never stored: only salted hashes and coarse families.

create extension if not exists pgcrypto;

create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80),
  country_code char(2) not null,
  tier text check (tier in ('gold', 'silver', 'bronze')),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'affiliate')),
  affiliate_id uuid null references public.affiliates (id) on delete set null
);

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  campaign_name text not null check (length(campaign_name) between 2 and 80),
  destination_url text not null check (destination_url like 'https://%'),
  target_countries char(2)[] not null,
  purpose text not null default 'campaign' check (purpose in ('campaign', 'replay', 'loadtest')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists links_affiliate_idx on public.links (affiliate_id);

create table if not exists public.click_events (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.links (id) on delete cascade,
  clicked_at timestamptz not null default now(),
  ip_hash text not null,
  country_code char(2) null,
  ua_family text not null,
  device_type text check (device_type in ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  is_bot boolean null, -- NULL = unknown (e.g. replay data has no user agent)
  referrer_domain text null check (length(referrer_domain) <= 100),
  dataset text not null check (dataset in ('live', 'simulated', 'replay')),
  scenario text null
);
create index if not exists click_events_link_time_idx on public.click_events (link_id, clicked_at desc);
create index if not exists click_events_time_idx on public.click_events (clicked_at);
create index if not exists click_events_link_ip_time_idx on public.click_events (link_id, ip_hash, clicked_at);

create table if not exists public.conversions (
  id uuid primary key default gen_random_uuid(),
  event_id text unique not null,
  click_id uuid not null references public.click_events (id) on delete cascade,
  link_id uuid not null references public.links (id) on delete cascade,
  type text not null check (type in ('signup', 'ftd')),
  amount_usd numeric(12, 2) null check (amount_usd >= 0),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists conversions_link_time_idx on public.conversions (link_id, occurred_at);
create index if not exists conversions_click_idx on public.conversions (click_id);

create table if not exists public.link_stats_hourly (
  link_id uuid not null references public.links (id) on delete cascade,
  hour timestamptz not null,
  clicks int not null default 0,
  unique_ips int not null default 0,
  bot_clicks int not null default 0,
  unknown_bot_clicks int not null default 0,
  off_target_clicks int not null default 0,
  unknown_country_clicks int not null default 0,
  signups int not null default 0,
  ftds int not null default 0,
  deposits_usd numeric(12, 2) not null default 0,
  primary key (link_id, hour)
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.links (id) on delete cascade,
  rule_code text not null check (rule_code in ('IP_BURST', 'BOT_SHARE', 'NO_CONVERSIONS', 'GEO_MISMATCH', 'CLICK_SPIKE')),
  severity text not null check (severity in ('low', 'medium', 'high')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  evidence jsonb not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  -- Human feedback loop: set by an admin on Resolve. Future training labels.
  resolution text null check (resolution in ('confirmed_fraud', 'false_alarm', 'inconclusive')),
  ai_status text not null default 'pending' check (ai_status in ('pending', 'done', 'template', 'failed')),
  ai_summary text null,
  ai_likely_cause text null check (ai_likely_cause in ('bot_traffic', 'click_farm', 'misconfigured_targeting', 'organic_spike', 'tracking_issue', 'unknown')),
  ai_recommended_action text null check (ai_recommended_action in ('monitor', 'contact_affiliate', 'pause_link', 'investigate_manually')),
  ai_explanation text null,
  created_at timestamptz not null default now(),
  unique (link_id, rule_code, window_start)
);
create index if not exists alerts_created_idx on public.alerts (created_at desc);

create table if not exists public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  alert_id uuid null references public.alerts (id) on delete set null,
  stage text not null,
  provider text not null,
  model text not null,
  prompt_hash text not null,
  prompt_version text not null,
  input_tokens int null,
  output_tokens int null,
  est_cost_usd numeric(10, 6) null,
  duration_ms int null,
  attempt int not null default 1,
  status text not null check (status in ('ok', 'schema_retry', 'failed', 'timeout', 'rate_limited')),
  error text null
);
create index if not exists llm_calls_created_idx on public.llm_calls (created_at);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null check (job in ('rollup', 'detect', 'explain', 'simulate', 'replay')),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  status text not null check (status in ('ok', 'partial', 'failed')),
  stats jsonb not null default '{}'::jsonb
);
create index if not exists job_runs_started_idx on public.job_runs (started_at desc);

create table if not exists public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('randomised', 'false_alarm', 'sensitivity', 'held_out', 'replay', 'load_test', 'security')),
  git_sha text null,
  config_hash text not null,
  seed int null,
  summary jsonb not null,
  details jsonb not null
);
create index if not exists eval_runs_kind_created_idx on public.eval_runs (kind, created_at desc);
