-- SignalDesk 001: tables, indexes and server-only helper functions.
-- RLS is enabled on every table in 002_rls.sql. Only titles, short excerpts and a few relevant
-- sentences are stored - never full articles.

create extension if not exists pgcrypto;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  feed_url text not null unique check (feed_url like 'https://%'),
  site_domain text not null,
  kind text not null check (kind in ('central_bank', 'news', 'markets')),
  is_active boolean not null default true,
  etag text null,
  last_modified text null,
  last_fetched_at timestamptz null,
  last_status text null,
  consecutive_failures int not null default 0
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,30}$'),
  name text not null,
  asset_type text not null check (asset_type in ('currency_pair', 'commodity', 'index', 'stock', 'crypto', 'central_bank')),
  description_simple text not null
);

create table if not exists public.asset_aliases (
  asset_id uuid not null references public.assets (id) on delete cascade,
  alias text not null check (length(alias) between 1 and 60),
  is_case_sensitive boolean not null default false,
  primary key (asset_id, alias)
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  headline text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  article_count int not null default 1,
  source_count int not null default 1
);
create index if not exists stories_last_seen_idx on public.stories (last_seen_at desc);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  url text not null unique check (url ~ '^https?://'),
  url_hash text not null unique,
  title text not null check (length(title) <= 500),
  excerpt text not null default '' check (length(excerpt) <= 500),
  published_at timestamptz null,
  fetched_at timestamptz not null default now(),
  story_id uuid null references public.stories (id) on delete set null,
  language text not null default 'en'
);
create index if not exists articles_published_idx on public.articles (published_at desc);
create index if not exists articles_story_idx on public.articles (story_id);
create index if not exists articles_fetched_idx on public.articles (fetched_at desc);

-- sentences = [{ "id": "S1", "text": "..." }]: mentioning sentences + one neighbour each side, max 6.
create table if not exists public.asset_mentions (
  article_id uuid not null references public.articles (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  sentences jsonb not null check (jsonb_typeof(sentences) = 'array' and jsonb_array_length(sentences) between 1 and 6),
  primary key (article_id, asset_id)
);
create index if not exists asset_mentions_asset_idx on public.asset_mentions (asset_id);

create table if not exists public.asset_signals (
  article_id uuid not null references public.articles (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  stance text not null check (stance in ('bullish', 'bearish', 'hawkish', 'dovish', 'neutral', 'unclear')),
  strength smallint not null check (strength between 0 and 3),
  evidence_ids text[] not null,
  why text not null default '' check (length(why) <= 200),
  status text not null check (status in ('ok', 'unclear', 'failed')),
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  primary key (article_id, asset_id),
  foreign key (article_id, asset_id) references public.asset_mentions (article_id, asset_id) on delete cascade
);
create index if not exists asset_signals_asset_idx on public.asset_signals (asset_id, created_at desc);

create table if not exists public.daily_mood (
  asset_id uuid not null references public.assets (id) on delete cascade,
  day date not null,
  score numeric(5, 3) not null check (score between -1 and 1),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  article_count int not null,
  source_count int not null,
  agreement numeric(4, 3) not null,
  primary key (asset_id, day)
);

create table if not exists public.watchlists (
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  beginner_mode boolean not null default false
);

-- bullets = [{ "text": "...", "asset_slugs": [], "article_ids": [] }]
create table if not exists public.briefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  level text not null check (level in ('standard', 'beginner')),
  watchlist_hash text not null,
  bullets jsonb not null,
  source text not null default 'ai' check (source in ('ai', 'template')),
  created_at timestamptz not null default now(),
  primary key (user_id, day, level, watchlist_hash)
);

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

-- Mentions that still need a stance, newest articles first (server-only).
create or replace function public.pending_signal_pairs(p_limit int)
returns table (article_id uuid, asset_id uuid, asset_name text, asset_type text, sentences jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select m.article_id, m.asset_id, a.name, a.asset_type, m.sentences
  from public.asset_mentions m
  join public.assets a on a.id = m.asset_id
  join public.articles ar on ar.id = m.article_id
  where not exists (select 1 from public.asset_signals s where s.article_id = m.article_id and s.asset_id = m.asset_id)
    and coalesce(ar.published_at, ar.fetched_at) > now() - interval '7 days'
  order by coalesce(ar.published_at, ar.fetched_at) desc
  limit greatest(0, least(p_limit, 500));
$$;

-- Recomputes counts and time range for the given stories from their articles (server-only).
create or replace function public.refresh_stories(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.stories s
  set article_count = x.n,
      source_count = x.sources,
      first_seen_at = x.first_seen,
      last_seen_at = x.last_seen
  from (
    select story_id, count(*)::int as n, count(distinct source_id)::int as sources,
           min(coalesce(published_at, fetched_at)) as first_seen, max(coalesce(published_at, fetched_at)) as last_seen
    from public.articles
    where story_id = any (p_ids)
    group by story_id
  ) x
  where s.id = x.story_id;
$$;

revoke execute on function public.pending_signal_pairs(int) from public, anon, authenticated;
revoke execute on function public.refresh_stories(uuid[]) from public, anon, authenticated;
grant execute on function public.pending_signal_pairs(int) to service_role;
grant execute on function public.refresh_stories(uuid[]) to service_role;
