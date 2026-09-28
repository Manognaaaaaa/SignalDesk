-- SignalDesk 005: record WHY a stance failed validation (Phase 2).
-- A 'failed' row is an answer that was still invalid after one retry. It is kept as stance
-- 'unclear' (never used by the mood) with the reason, instead of being dropped silently.
--   invalid_json  - the output was not JSON
--   bad_citation  - evidence_ids cited a sentence ID that is not in the input
--   schema        - any other rule (stance not allowed for the asset type, strength range, ...)
-- Additive and idempotent: existing rows keep NULL.

alter table public.asset_signals add column if not exists failure_reason text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asset_signals_failure_reason_check') then
    alter table public.asset_signals
      add constraint asset_signals_failure_reason_check
      check (failure_reason is null or (status = 'failed' and failure_reason in ('invalid_json', 'bad_citation', 'schema')));
  end if;
end $$;
