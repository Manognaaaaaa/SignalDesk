import "server-only";
import { z } from "zod";

/**
 * Server environment schema, validated once (and at boot via instrumentation.ts) so a
 * misconfigured deploy fails fast with the NAME of the bad variable - never its value.
 */
const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  GROQ_PRICE_IN_PER_M: z.coerce.number().nonnegative().default(0.15),
  GROQ_PRICE_OUT_PER_M: z.coerce.number().nonnegative().default(0.75),
  CRON_SECRET: z.string().min(16, "must be at least 16 characters"),
  APP_BASE_URL: z.url(),
  ADMIN_EMAILS: z.string().default("").transform(csv),
  MAX_LLM_CALLS_PER_DAY: z.coerce.number().int().nonnegative().default(400),
  MAX_STANCE_CALLS_PER_RUN: z.coerce.number().int().nonnegative().default(60),
  PROMPT_VERSION: z.string().default("v1"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Treats empty strings as unset so optional/default values behave as expected. */
function cleanedProcessEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) out[k] = v === undefined || v.trim() === "" ? undefined : v.trim();
  return out;
}

/** Returns the validated env; the error lists variable names and rules only (safe to log). */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(cleanedProcessEnv());
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join(", ");
    throw new Error(`Invalid or missing environment variables: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
