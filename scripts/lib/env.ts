/**
 * Env loading for CLI scripts (they run outside Next.js, so they cannot import the
 * "server-only" modules). Each script asks only for the variables it needs; errors name the
 * variable, never its value.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function requireEnv(...names: string[]): Record<string, string> {
  const missing = names.filter((n) => !process.env[n] || process.env[n]!.trim() === "");
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")} (set them in .env.local)`);
    process.exit(1);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]!.trim()]));
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

/** Service-role client for local scripts. Never used in browser code. */
export function adminClient(): SupabaseClient {
  const env = requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Parses --key=value and --flag arguments. */
export function parseArgs(argv = process.argv.slice(2)): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) out[a.slice(2)] = argv[++i]!;
    else out[a.slice(2)] = true;
  }
  return out;
}
