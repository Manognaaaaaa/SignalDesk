-- SignalDesk 004: schedule the ingest job with pg_cron + pg_net.
-- Why not Vercel Cron? On the Hobby plan it only runs once per day; news needs every 2 hours.
--
-- PREREQUISITES (once, manually, in the SQL editor - NEVER commit the real values):
--   1. Enable the pg_cron and pg_net extensions (Database -> Extensions).
--   2. select vault.create_secret('https://<your-app>.vercel.app', 'app_base_url');
--      select vault.create_secret('<CRON_SECRET value>', 'cron_secret');
-- The job reads both from Vault at run time, so no URL or secret lives in git.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'signaldesk-ingest';
end $$;

-- Every 2 hours, at minute 7 (off the top of the hour).
select cron.schedule(
  'signaldesk-ingest',
  '7 */2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/jobs/ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
