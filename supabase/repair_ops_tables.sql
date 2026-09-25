-- ONE-OFF REPAIR: recreates SignalDesk's llm_calls and job_runs tables (with RLS on and no user
-- access) if an earlier run of reset_linkpulse.sql dropped them. Safe to run any number of times;
-- it does not touch any other table or data.

create table if not exists public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  stage text not null check (stage in ('stance', 'brief')),
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
  job text not null check (job in ('ingest', 'score', 'mood')),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  status text not null check (status in ('ok', 'partial', 'failed')),
  stats jsonb not null default '{}'::jsonb
);

-- Service role only: RLS on, no policies, no client privileges.
alter table public.llm_calls enable row level security;
alter table public.job_runs enable row level security;
revoke all on public.llm_calls, public.job_runs from anon, authenticated;

-- Make the API see the tables immediately.
notify pgrst, 'reload schema';
