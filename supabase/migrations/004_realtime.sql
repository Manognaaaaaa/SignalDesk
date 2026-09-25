-- LinkPulse 004: Realtime.
-- alerts and link_stats_hourly stream to dashboards via postgres_changes (RLS still applies:
-- an affiliate only receives rows they can SELECT).
-- click_events is deliberately NOT published: it is the hottest table and would fan out every
-- row to every client. The live ticker uses a throttled Broadcast channel ("clicks") with a tiny
-- non-PII payload instead.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alerts') then
    alter publication supabase_realtime add table public.alerts;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'link_stats_hourly') then
    alter publication supabase_realtime add table public.link_stats_hourly;
  end if;
end $$;
