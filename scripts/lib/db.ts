/**
 * Direct Postgres connection for CLI scripts that need more than the Supabase API
 * (migrations, pg_cron, Vault). DATABASE_URL is read from the environment and never printed.
 */
import pg from "pg";
import { requireEnv } from "./env";

/** Host only, for messages - never the user, password or full URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/** Connects with TLS, or exits with a helpful, secret-free message. */
export async function connectDb(): Promise<pg.Client> {
  const { DATABASE_URL } = requireEnv("DATABASE_URL");
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
  return client;
}
