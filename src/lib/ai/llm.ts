import "server-only";
import { createHash } from "node:crypto";
import Groq from "groq-sdk";
import type { z } from "zod";
import { serverEnv } from "@/lib/env";
import { LruTtlCache } from "@/lib/lru";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Groq wrapper used by every LLM call. Responsibilities:
 *  - 15 s timeout (AbortController); retries ONLY on 429/5xx (max 2, 500/1500 ms + jitter,
 *    honours Retry-After), never on 400/401/403,
 *  - one schema retry with the zod error appended; after that the caller falls back to a
 *    template (we never regex-guess JSON out of broken output). Each validation failure is
 *    classified (invalid_json / bad_citation / schema) in the audit row and in the result,
 *  - daily call cap, in-memory cache by prompt hash, and one llm_calls audit row per attempt
 *    recording hashes, token counts and cost - never the key, headers or prompt text.
 */

/** "eval_judge" is only used by eval scripts, whose calls are logged locally (llm_calls allows stance | brief). */
export type Stage = "stance" | "brief" | "eval_judge";

export type CallStatus = "ok" | "schema_retry" | "failed" | "timeout" | "rate_limited";

export type LlmCallRecord = {
  stage: Stage;
  model: string;
  prompt_hash: string;
  prompt_version: string;
  input_tokens: number | null;
  output_tokens: number | null;
  est_cost_usd: number | null;
  duration_ms: number;
  attempt: number;
  status: CallStatus;
  error: string | null;
};

type Completion = {
  choices: { message: { content: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

/** Minimal client surface so tests can inject a fake instead of the real SDK. */
export type ChatClient = {
  create: (body: Record<string, unknown>, opts: { signal: AbortSignal }) => Promise<Completion>;
};

export type LlmDeps = {
  client: ChatClient | null;
  model: string;
  promptVersion: string;
  priceInPerM: number;
  priceOutPerM: number;
  maxCallsPerDay: number;
  countCallsToday: () => Promise<number>;
  logCall: (rec: LlmCallRecord) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  timeoutMs: number;
};

/**
 * Why an output failed validation: not JSON at all, cited an ID that is not in the input
 * (evidence_ids / article_ids), or broke some other schema rule (wrong enum, missing field...).
 */
export type ValidationFailure = "invalid_json" | "bad_citation" | "schema";

/** Fields that hold citations; a zod issue under one of them counts as a bad citation. */
const CITATION_FIELDS = new Set(["evidence_ids", "article_ids"]);

export function classifyIssues(issues: { path: PropertyKey[] }[]): ValidationFailure {
  return issues.some((i) => i.path.some((p) => typeof p === "string" && CITATION_FIELDS.has(p))) ? "bad_citation" : "schema";
}

export type LlmResult<T> =
  /** `firstFailure` is set when the first answer was invalid and the one retry fixed it. */
  | { ok: true; data: T; cached: boolean; calls: number; firstFailure: ValidationFailure | null }
  | { ok: false; reason: "no_key" | "cap" | "http" | "timeout"; calls: number }
  | { ok: false; reason: "schema"; failure: ValidationFailure; firstFailure: ValidationFailure; calls: number };

export const BACKOFF_MS = [500, 1500];
const MAX_HTTP_RETRIES = 2;
const cache = new LruTtlCache<unknown>(500, 60 * 60_000);

/** Clears the response cache (tests). */
export function clearLlmCache() {
  cache.clear();
}

/** Groq reasoning models accept reasoning_effort; others would reject it. */
export const isReasoningModel = (model: string) => /gpt-oss|qwen3|deepseek-r1/i.test(model);

/** sha256 over everything that determines the output; used for caching and auditing. */
export function promptHash(system: string, user: string, model: string, version: string): string {
  return createHash("sha256").update(`${system}\n${user}\n${model}\n${version}`).digest("hex");
}

function httpStatus(err: unknown): number | null {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : null;
}

/** Retry-After in ms from an SDK error's headers (Headers object or plain record), capped at 10 s. */
function retryAfterMs(err: unknown): number | null {
  const h = (err as { headers?: unknown })?.headers;
  let v: string | null | undefined;
  if (h && typeof (h as Headers).get === "function") v = (h as Headers).get("retry-after");
  else if (h && typeof h === "object") v = (h as Record<string, string>)["retry-after"];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(n * 1000, 10_000) : null;
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  return name === "AbortError" || name === "APIUserAbortError" || name === "APIConnectionTimeoutError";
}

/** Short, secret-free error label for the audit log. */
function errorLabel(err: unknown): string {
  const s = httpStatus(err);
  if (s) return `http_${s}`;
  if (isAbort(err)) return "timeout";
  return (err as { name?: string })?.name?.slice(0, 40) ?? "error";
}

let defaultDeps: LlmDeps | null = null;

/** Production dependencies built from env. Without GROQ_API_KEY, client is null (template mode). */
export function getDefaultDeps(): LlmDeps {
  if (defaultDeps) return defaultDeps;
  const env = serverEnv();
  const groq = env.GROQ_API_KEY ? new Groq({ apiKey: env.GROQ_API_KEY, maxRetries: 0 }) : null;
  defaultDeps = {
    client: groq
      ? {
          create: (body, opts) =>
            groq.chat.completions.create(body as never, { signal: opts.signal }) as unknown as Promise<Completion>,
        }
      : null,
    model: env.GROQ_MODEL,
    promptVersion: env.PROMPT_VERSION,
    priceInPerM: env.GROQ_PRICE_IN_PER_M,
    priceOutPerM: env.GROQ_PRICE_OUT_PER_M,
    maxCallsPerDay: env.MAX_LLM_CALLS_PER_DAY,
    countCallsToday: async () => {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const { count, error } = await supabaseAdmin()
        .from("llm_calls")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since.toISOString());
      if (error) throw new Error("count failed");
      return count ?? 0;
    },
    logCall: async (rec) => {
      try {
        const { error } = await supabaseAdmin().from("llm_calls").insert(rec);
        if (error) console.error("[llm] audit insert failed");
      } catch {
        console.error("[llm] audit insert failed");
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    timeoutMs: 15_000,
  };
  return defaultDeps;
}

/**
 * Calls the model for a JSON object and validates it with `schema`.
 * Never throws: returns ok:false so callers can always fall back to a template.
 */
export async function callJson<T>(
  stage: Stage,
  system: string,
  user: string,
  schema: z.ZodType<T>,
  opts: { maxTokens?: number; deps?: LlmDeps } = {},
): Promise<LlmResult<T>> {
  const deps = opts.deps ?? getDefaultDeps();
  if (!deps.client) return { ok: false, reason: "no_key", calls: 0 };

  const hash = promptHash(system, user, deps.model, deps.promptVersion);
  const hit = cache.get(hash);
  if (hit !== undefined) return { ok: true, data: hit as T, cached: true, calls: 0, firstFailure: null };

  try {
    if ((await deps.countCallsToday()) >= deps.maxCallsPerDay) return { ok: false, reason: "cap", calls: 0 };
  } catch {
    return { ok: false, reason: "cap", calls: 0 }; // cannot verify the budget -> fail closed
  }

  let attempt = 0;
  let calls = 0;
  let userMsg = user;
  let firstFailure: ValidationFailure | null = null;
  let httpRetries = 0;

  for (;;) {
    attempt++;
    calls++;
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs);
    const base = {
      stage,
      model: deps.model,
      prompt_hash: hash,
      prompt_version: deps.promptVersion,
      attempt,
    };
    try {
      const res = await deps.client.create(
        {
          model: deps.model,
          temperature: 0,
          max_tokens: opts.maxTokens ?? 400,
          response_format: { type: "json_object" },
          // Reasoning models (gpt-oss) spend completion tokens on hidden reasoning; keep it short
          // so the small token budgets go to the JSON answer.
          ...(isReasoningModel(deps.model) ? { reasoning_effort: "low" } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
        },
        { signal: ctrl.signal },
      );
      clearTimeout(timer);
      const inTok = res.usage?.prompt_tokens ?? null;
      const outTok = res.usage?.completion_tokens ?? null;
      const cost =
        inTok !== null && outTok !== null ? (inTok * deps.priceInPerM + outTok * deps.priceOutPerM) / 1_000_000 : null;
      const usage = { input_tokens: inTok, output_tokens: outTok, est_cost_usd: cost, duration_ms: Date.now() - started };

      let parsedJson: unknown;
      let problem: string | null = null;
      let failure: ValidationFailure = "invalid_json";
      try {
        parsedJson = JSON.parse(res.choices[0]?.message.content ?? "");
      } catch {
        problem = "Output was not valid JSON.";
      }
      if (!problem) {
        const v = schema.safeParse(parsedJson);
        if (v.success) {
          await deps.logCall({ ...base, ...usage, status: "ok", error: null });
          cache.set(hash, v.data);
          return { ok: true, data: v.data, cached: false, calls, firstFailure };
        }
        failure = classifyIssues(v.error.issues);
        problem = v.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      }
      if (firstFailure === null) {
        firstFailure = failure;
        await deps.logCall({ ...base, ...usage, status: "schema_retry", error: failure });
        userMsg = `${user}\n\nYour previous output failed validation: ${problem.slice(0, 500)} Return corrected JSON only.`;
        continue;
      }
      await deps.logCall({ ...base, ...usage, status: "failed", error: failure });
      return { ok: false, reason: "schema", failure, firstFailure, calls };
    } catch (err) {
      clearTimeout(timer);
      const status = httpStatus(err);
      const nil = { input_tokens: null, output_tokens: null, est_cost_usd: null, duration_ms: Date.now() - started };
      if (isAbort(err)) {
        await deps.logCall({ ...base, ...nil, status: "timeout", error: "timeout" });
        return { ok: false, reason: "timeout", calls };
      }
      const retryable = status === 429 || (status !== null && status >= 500);
      await deps.logCall({ ...base, ...nil, status: status === 429 ? "rate_limited" : "failed", error: errorLabel(err) });
      if (!retryable || httpRetries >= MAX_HTTP_RETRIES) return { ok: false, reason: "http", calls };
      const backoff = BACKOFF_MS[httpRetries]! + Math.floor(deps.random() * 250);
      httpRetries++;
      await deps.sleep(Math.max(backoff, retryAfterMs(err) ?? 0));
    }
  }
}
