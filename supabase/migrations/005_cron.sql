-- LinkPulse 005: scheduling with pg_cron + pg_net.
-- Why not Vercel Cron? On the Hobby plan it only runs once per day; detection needs 5 minutes.
--
-- PREREQUISITE (run once, manually, in the SQL editor - NEVER commit the real values):
--   select vault.create_secret('https://<your-app>.vercel.app', 'app_base_url');
--   select vault.create_secret('<CRON_SECRET value>', 'cron_secret');
-- The job below reads both from Vault at run time, so no URL or secret lives in git.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove old versions so this migration is re-runnable.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('linkpulse-rollup', 'linkpulse-detect');
end $$;

-- Every 5 minutes: refresh the last 2 hours of hourly rollups (idempotent upsert).
select cron.schedule(
  'linkpulse-rollup',
  '*/5 * * * *',
  $$ select public.rollup_hourly(now() - interval '2 hours'); $$
);

-- Every 5 minutes, offset by 1 minute: call the detection job over HTTPS with the bearer secret.
select cron.schedule(
  'linkpulse-detect',
  '1-59/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/jobs/detect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
