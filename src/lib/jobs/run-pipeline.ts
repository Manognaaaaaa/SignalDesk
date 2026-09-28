import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerEnv } from "@/lib/env";
import { runIngestSteps } from "./ingest-job";
import { runMoodStep } from "./mood-job";
import { runPriceStep } from "./price-job";
import { runScoreStep } from "./score-job";

/**
 * The full background job: ingest (steps 1-4) -> score (5) -> mood (6) -> prices (7). Each step writes its own
 * job_runs row with stats. A failing step is recorded and the next step still runs, so e.g. a
 * Groq outage never stops ingestion or mood updates.
 */

type Step = "ingest" | "score" | "mood" | "prices";

/** Time kept back from scoring for the prices step (2 symbols x ~3.5 s, plus margin). */
const PRICE_RESERVE_MS = 9_000;

async function recordStep<T>(db: SupabaseClient, job: Step, fn: () => Promise<T>): Promise<{ status: "ok" | "failed"; stats: T | { error: string } }> {
  const started = new Date().toISOString();
  let status: "ok" | "failed" = "ok";
  let stats: T | { error: string };
  try {
    stats = await fn();
  } catch (e) {
    status = "failed";
    stats = { error: e instanceof Error ? e.message.slice(0, 160) : "unknown" };
    console.error(`[job] ${job} failed`);
  }
  const { error } = await db.from("job_runs").insert({ job, started_at: started, finished_at: new Date().toISOString(), status, stats });
  if (error) console.error(`[job] could not record ${job} run`);
  return { status, stats };
}

export async function runPipeline(db: SupabaseClient, env: Pick<ServerEnv, "APP_BASE_URL" | "GROQ_API_KEY" | "MAX_STANCE_CALLS_PER_RUN">, opts: { timeBudgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 45_000;
  const ingest = await recordStep(db, "ingest", () => runIngestSteps(db, { appBaseUrl: env.APP_BASE_URL }));
  // Scoring would otherwise use all remaining time whenever there is a backlog, so the prices
  // step's time is reserved up front (Deriv's rate limit makes it ~3.5 s per symbol).
  const remaining = Math.max(5_000, budget - (Date.now() - started) - PRICE_RESERVE_MS);
  const score = await recordStep(db, "score", () => runScoreStep(db, { hasKey: Boolean(env.GROQ_API_KEY), maxCalls: env.MAX_STANCE_CALLS_PER_RUN, timeBudgetMs: remaining }));
  const mood = await recordStep(db, "mood", () => runMoodStep(db));
  // Skipped only if an earlier step overran; those symbols are then simply picked first next run.
  const prices = Date.now() - started < budget ? await recordStep(db, "prices", () => runPriceStep(db)) : { status: "ok" as const, stats: { skipped: "no_time" } };
  return { ingest, score, mood, prices, duration_ms: Date.now() - started };
}
