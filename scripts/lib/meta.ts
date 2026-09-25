import { execSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { optionalEnv } from "./env";

/** Short git sha of HEAD (or Vercel's), or null outside a git checkout. */
export function gitSha(): string | null {
  const v = optionalEnv("VERCEL_GIT_COMMIT_SHA");
  if (v) return v.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/** Service-role client if configured, else null (eval results then stay local only). */
export function optionalAdminClient(): SupabaseClient | null {
  const url = optionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = optionalEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
