-- SignalDesk 006: daily prices for the mood-vs-price chart.
-- Source: Deriv's public market-data API (no key). One row per asset per UTC day (daily candle).
-- Written only by the background job / backfill script (service role); public SELECT like other
-- market data. Additive and idempotent.

create table if not exists public.daily_prices (
  asset_id uuid not null references public.assets (id) on delete cascade,
  day date not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  source text not null default 'deriv',
  symbol text not null,
  fetched_at timestamptz not null default now(),
  primary key (asset_id, day),
  check (high >= low and close > 0)
);
create index if not exists daily_prices_day_idx on public.daily_prices (day desc);

alter table public.daily_prices enable row level security;
drop policy if exists daily_prices_public_read on public.daily_prices;
create policy daily_prices_public_read on public.daily_prices for select to anon, authenticated using (true);

-- The pipeline now records a 'prices' step in job_runs.
alter table public.job_runs drop constraint if exists job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check check (job in ('ingest', 'score', 'mood', 'prices'));
