-- SignalDesk 002: Row Level Security (deny by default).
-- Public news metadata is readable by everyone; users can only touch their own watchlist,
-- settings and briefs; operational tables are service-role only. All pipeline writes are done
-- by the server with the service role.

alter table public.sources enable row level security;
alter table public.assets enable row level security;
alter table public.asset_aliases enable row level security;
alter table public.articles enable row level security;
alter table public.stories enable row level security;
alter table public.asset_mentions enable row level security;
alter table public.asset_signals enable row level security;
alter table public.daily_mood enable row level security;
alter table public.watchlists enable row level security;
alter table public.user_settings enable row level security;
alter table public.briefs enable row level security;
alter table public.llm_calls enable row level security;
alter table public.job_runs enable row level security;

-- Defence in depth: remove client write privileges everywhere, then grant back only what users need.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
grant insert, delete on public.watchlists to authenticated;
grant insert, update on public.user_settings to authenticated;

-- Public news metadata: read-only for everyone.
do $$
declare t text;
begin
  foreach t in array array['sources', 'assets', 'asset_aliases', 'articles', 'stories', 'asset_mentions', 'asset_signals', 'daily_mood'] loop
    execute format('drop policy if exists %1$s_public_read on public.%1$s', t);
    execute format('create policy %1$s_public_read on public.%1$s for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- Watchlists: own rows only.
drop policy if exists watchlists_select_own on public.watchlists;
create policy watchlists_select_own on public.watchlists for select to authenticated using (user_id = auth.uid());
drop policy if exists watchlists_insert_own on public.watchlists;
create policy watchlists_insert_own on public.watchlists for insert to authenticated with check (user_id = auth.uid());
drop policy if exists watchlists_delete_own on public.watchlists;
create policy watchlists_delete_own on public.watchlists for delete to authenticated using (user_id = auth.uid());

-- Settings: own row only.
drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings for select to authenticated using (user_id = auth.uid());
drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings for insert to authenticated with check (user_id = auth.uid());
drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Briefs: read own; written only by the server.
drop policy if exists briefs_select_own on public.briefs;
create policy briefs_select_own on public.briefs for select to authenticated using (user_id = auth.uid());

-- llm_calls, job_runs: no policies at all -> no access for anon/authenticated.

-- Watchlist size limit (20), enforced in the database so no client can bypass it.
create or replace function public.enforce_watchlist_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.watchlists where user_id = new.user_id) >= 20 then
    raise exception 'watchlist limit reached (20 assets)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_watchlist_limit() from public, anon, authenticated;

drop trigger if exists watchlist_limit on public.watchlists;
create trigger watchlist_limit before insert on public.watchlists
  for each row execute function public.enforce_watchlist_limit();
