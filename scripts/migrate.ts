/**
 * npm run migrate [-- --with-cron]
 * Applies supabase/migrations/001..003 (and 004_cron with --with-cron) directly to the database,
 * so nobody has to paste SQL into the dashboard. Every migration is idempotent
 * (create if not exists / create or replace / on conflict), so re-running is safe.
 *
 * Needs DATABASE_URL in .env.local: the Postgres connection string from Supabase
 * (Connect -> "Session pooler"). It is only read from the environment and never printed.
 * The destructive supabase/reset_linkpulse.sql is deliberately NOT run by this script.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { parseArgs, requireEnv } from "./lib/env";

const FILES = ["001_tables.sql", "002_rls.sql", "003_seed_assets.sql"];

/** Host only, for messages - never the user, password or full URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main() {
  const { DATABASE_URL } = requireEnv("DATABASE_URL");
  const args = parseArgs();
  const files = args["with-cron"] ? [...FILES, "004_cron.sql"] : FILES;

  let url: URL;
  try {
    url = new URL(DATABASE_URL!);
  } catch {
    console.error("DATABASE_URL is not a valid postgres:// connection string.");
    process.exit(1);
  }
  if (url.password.includes("[") || url.password.toUpperCase().includes("YOUR-PASSWORD")) {
    console.error("DATABASE_URL still contains the [YOUR-PASSWORD] placeholder. Replace it with your database password.");
    process.exit(1);
  }
  // Supabase requires TLS. sslmode in the URL would override our ssl options, so drop it.
  url.searchParams.delete("sslmode");
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });

  try {
    await client.connect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    console.error(`Could not connect to ${hostOf(DATABASE_URL!)}.`);
    if (/password authentication failed/i.test(msg)) console.error("-> Wrong database password. Reset it in Supabase: Project Settings -> Database -> Reset database password.");
    else if (/ENOTFOUND|getaddrinfo/i.test(msg)) console.error("-> Host not found. Use the 'Session pooler' string from the Connect button (the direct db.* host needs IPv6).");
    else if (/tenant|user not found/i.test(msg)) console.error("-> Check the user part: the pooler user looks like postgres.<project-ref>.");
    else console.error(`-> ${msg.slice(0, 160)}`);
    process.exit(1);
  }

  console.log(`Connected to ${hostOf(DATABASE_URL!)}`);
  for (const f of files) {
    const sql = readFileSync(`supabase/migrations/${f}`, "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      console.log(`  applied ${f}`);
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      console.error(`  FAILED ${f}: ${e instanceof Error ? e.message.slice(0, 300) : "unknown error"}`);
      if (f === "004_cron.sql") console.error("  -> Enable pg_cron and pg_net, and create the two Vault secrets first (README section 8).");
      await client.end();
      process.exit(1);
    }
  }
  // Tell the Supabase API (PostgREST) to pick up the new tables and functions immediately.
  await client.query("notify pgrst, 'reload schema'");

  const { rows } = await client.query<{ assets: string; aliases: string; sources: string }>(
    "select (select count(*) from public.assets) as assets, (select count(*) from public.asset_aliases) as aliases, (select count(*) from public.sources) as sources",
  );
  const rls = await client.query<{ relname: string }>(
    "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
  );
  console.log(`Catalogue: ${rows[0]!.assets} assets, ${rows[0]!.aliases} aliases, ${rows[0]!.sources} sources.`);
  console.log(rls.rows.length === 0 ? "RLS is enabled on every public table." : `WARNING: RLS off on: ${rls.rows.map((r) => r.relname).join(", ")}`);
  await client.end();
  console.log("Done. Next: npm run ingest");
}

main().catch((e) => {
  console.error(`migrate failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`);
  process.exit(1);
});
