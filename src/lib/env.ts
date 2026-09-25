import "server-only";
import { z } from "zod";

/**
 * Server environment schema. Validated once, on first use (and at boot via instrumentation.ts),
 * so a misconfigured deploy fails fast with the NAME of the bad variable - never its value.
 */
const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

const secret = z.string().min(16, "must be at least 16 characters");

export const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  GROQ_API_KEY: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GROQ_PRICE_IN_PER_M: z.coerce.number().nonnegative().default(0.59),
  GROQ_PRICE_OUT_PER_M: z.coerce.number().nonnegative().default(0.79),
  CONVERSION_WEBHOOK_SECRET: secret,
  CRON_SECRET: secret,
  IP_HASH_SALT: secret,
  ALLOWED_DESTINATION_DOMAINS: z
    .string()
    .min(1)
    .transform(csv)
    .pipe(z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1)),
  APP_BASE_URL: z.url().optional(),
  MAX_LLM_CALLS_PER_DAY: z.coerce.number().int().nonnegative().default(300),
  MAX_EXPLANATIONS_PER_RUN: z.coerce.number().int().nonnegative().default(10),
  PROMPT_VERSION: z.string().default("v1"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Treat empty strings as unset so optional/default values behave as expected. */
function cleanedProcessEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) out[k] = v === "" ? undefined : v;
  return out;
}

/**
 * Returns the validated server env. Throws an Error listing only variable names and the
 * rule they broke - values are never included, so the message is safe to log.
 */
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

/** True when a Groq key is configured; without it every explanation uses templates. */
export function hasGroq(): boolean {
  return Boolean(serverEnv().GROQ_API_KEY);
}
