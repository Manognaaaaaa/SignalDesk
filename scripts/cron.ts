/**
 * npm run cron -- status
 *   Checks the production schedule: are pg_cron/pg_net installed, is 'signaldesk-ingest'
 *   scheduled and active, do both Vault secrets exist, does the stored cron_secret match
 *   CRON_SECRET in .env.local (compared inside Postgres, never printed), and what happened on
 *   the last runs (cron.job_run_details + the HTTP status pg_net got back).
 *
 * npm run cron -- setup --url https://<your-app>.vercel.app
 *   Creates or updates the two Vault secrets (app_base_url from --url, cron_secret from
 *   CRON_SECRET) and applies supabase/migrations/004_cron.sql. Idempotent.
 *
 * Needs DATABASE_URL (Supabase -> Connect -> Session pooler). Secrets are passed as query
 * parameters and never logged.
 */
import { readFileSync } from "node:fs";
import type pg from "pg";
import { connectDb } from "./lib/db";
import { parseArgs, requireEnv } from "./lib/env";

const JOB = "signaldesk-ingest";

async function upsertSecret(db: pg.Client, name: string, value: string) {
  const { rowCount } = await db.query("select vault.update_secret(id, $1) from vault.secrets where name = $2", [value, name]);
  if (!rowCount) await db.query("select vault.create_secret($1, $2)", [value, name]);
}

async function status(db: pg.Client) {
  const ext = await db.query<{ extname: string }>("select extname from pg_extension where extname in ('pg_cron', 'pg_net')");
  const have = new Set(ext.rows.map((r) => r.extname));
  console.log(`pg_cron: ${have.has("pg_cron") ? "installed" : "MISSING"} · pg_net: ${have.has("pg_net") ? "installed" : "MISSING"}`);
  if (!have.has("pg_cron")) return console.log("-> Enable pg_cron and pg_net (Database -> Extensions), then run: npm run cron -- setup --url <app url>");

  const secrets = await db.query<{ name: string; host: string | null; matches: boolean | null }>(
    `select name,
            case when name = 'app_base_url' then decrypted_secret end as host,
            case when name = 'cron_secret' then decrypted_secret = $1 end as matches
     from vault.decrypted_secrets where name in ('app_base_url', 'cron_secret')`,
    [process.env.CRON_SECRET?.trim() ?? ""],
  );
  const byName = new Map(secrets.rows.map((r) => [r.name, r]));
  const url = byName.get("app_base_url")?.host;
  console.log(`vault app_base_url: ${url ?? "MISSING"}`);
  const m = byName.get("cron_secret");
  console.log(`vault cron_secret: ${!m ? "MISSING" : m.matches ? "present, matches local CRON_SECRET" : "present, DIFFERS from local CRON_SECRET"}`);

  const job = await db.query<{ jobid: number; schedule: string; active: boolean }>("select jobid, schedule, active from cron.job where jobname = $1", [JOB]);
  if (!job.rows[0]) return console.log(`cron job '${JOB}': NOT SCHEDULED -> run: npm run cron -- setup --url <app url>`);
  const j = job.rows[0];
  console.log(`cron job '${JOB}': schedule '${j.schedule}', ${j.active ? "active" : "INACTIVE"}`);

  const runs = await db.query<{ start_time: Date; status: string; return_message: string | null }>(
    "select start_time, status, return_message from cron.job_run_details where jobid = $1 order by start_time desc limit 8",
    [j.jobid],
  );
  console.log(`\nLast cron runs (${runs.rows.length}):`);
  for (const r of runs.rows) console.log(`  ${r.start_time.toISOString()}  ${r.status}  ${(r.return_message ?? "").slice(0, 120)}`);

  const http = await db
    .query<{ created: Date; status_code: number | null; timed_out: boolean | null; error_msg: string | null }>(
      "select created, status_code, timed_out, error_msg from net._http_response order by created desc limit 8",
    )
    .catch(() => ({ rows: [] }));
  console.log(`\nLast pg_net responses (${http.rows.length}, kept ~6 h by pg_net):`);
  for (const r of http.rows) console.log(`  ${r.created.toISOString()}  ${r.status_code ?? "-"}${r.timed_out ? " TIMED OUT" : ""}  ${(r.error_msg ?? "").slice(0, 120)}`);
}

async function setup(db: pg.Client, url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    console.error("--url must be the app's https URL, e.g. https://your-app.vercel.app");
    process.exit(1);
  }
  if (u.protocol !== "https:") {
    console.error("--url must use https.");
    process.exit(1);
  }
  const { CRON_SECRET } = requireEnv("CRON_SECRET");
  await db.query("create extension if not exists pg_cron");
  await db.query("create extension if not exists pg_net");
  await upsertSecret(db, "app_base_url", u.origin);
  await upsertSecret(db, "cron_secret", CRON_SECRET!);
  console.log(`Vault secrets set (app_base_url = ${u.origin}, cron_secret = CRON_SECRET from .env.local).`);
  await db.query(readFileSync("supabase/migrations/004_cron.sql", "utf8"));
  console.log("Applied 004_cron.sql.\n");
  await status(db);
}

async function main() {
  const args = parseArgs();
  const cmd = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "status";
  const db = await connectDb();
  try {
    if (cmd === "status") await status(db);
    else if (cmd === "setup") {
      if (typeof args.url !== "string") {
        console.error("Usage: npm run cron -- setup --url https://your-app.vercel.app");
        process.exit(1);
      }
      await setup(db, args.url);
    } else {
      console.error("Usage: npm run cron -- status | setup --url <https url>");
      process.exit(1);
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(`cron failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`);
  process.exit(1);
});
