import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetType } from "@/config/assets-seed";
import type { LlmDeps, ValidationFailure } from "@/lib/ai/llm";
import { scoreStance } from "@/lib/ai/stance";
import { mapWithConcurrency } from "@/lib/ingest/feeds";
import type { Sentence } from "@/lib/ingest/sentences";

/**
 * Step 5: stance scoring. Takes up to MAX_STANCE_CALLS_PER_RUN unscored (article, asset) pairs,
 * newest first, and scores each with ONE model call. Pairs not reached (cap, time budget, no key,
 * transient errors) simply wait for the next run. One failure never stops the loop.
 */

/**
 * Validation health for one run, over pairs that got an answer (saved rows):
 * how many passed first time, were fixed by the one retry, or still failed (saved as 'failed').
 * Reasons are counted for the first invalid answer and for the final failure.
 */
export type ValidationStats = {
  answered: number;
  first_attempt_ok: number;
  retried_then_ok: number;
  failed_after_retry: number;
  first_failure_reasons: Partial<Record<ValidationFailure, number>>;
  final_failure_reasons: Partial<Record<ValidationFailure, number>>;
  first_attempt_pass_rate: number | null;
  retry_rate: number | null;
  failure_rate: number | null;
};

export type ScoreStats = {
  ai_offline: boolean;
  pending: number;
  saved: number;
  ok: number;
  unclear: number;
  failed: number;
  skipped: number;
  skip_reasons: Record<string, number>;
  llm_calls: number;
  stopped_for_time: boolean;
  validation: ValidationStats;
};

const emptyValidation = (): ValidationStats => ({
  answered: 0,
  first_attempt_ok: 0,
  retried_then_ok: 0,
  failed_after_retry: 0,
  first_failure_reasons: {},
  final_failure_reasons: {},
  first_attempt_pass_rate: null,
  retry_rate: null,
  failure_rate: null,
});

const bump = (m: Partial<Record<ValidationFailure, number>>, k: ValidationFailure) => {
  m[k] = (m[k] ?? 0) + 1;
};

/** Adds the rates once all pairs are processed (null when nothing was answered). */
export function finaliseValidation(v: ValidationStats): ValidationStats {
  const rate = (n: number) => (v.answered ? Number((n / v.answered).toFixed(3)) : null);
  return { ...v, first_attempt_pass_rate: rate(v.first_attempt_ok), retry_rate: rate(v.retried_then_ok + v.failed_after_retry), failure_rate: rate(v.failed_after_retry) };
}

type Pending = { article_id: string; asset_id: string; asset_name: string; asset_type: AssetType; sentences: Sentence[] };

export async function runScoreStep(db: SupabaseClient, opts: { hasKey: boolean; maxCalls: number; timeBudgetMs: number; deps?: LlmDeps }): Promise<ScoreStats> {
  const stats: ScoreStats = { ai_offline: !opts.hasKey, pending: 0, saved: 0, ok: 0, unclear: 0, failed: 0, skipped: 0, skip_reasons: {}, llm_calls: 0, stopped_for_time: false, validation: emptyValidation() };
  if (!opts.hasKey || opts.maxCalls <= 0) return stats;
  const deadline = Date.now() + opts.timeBudgetMs;

  const { data, error } = await db.rpc("pending_signal_pairs", { p_limit: opts.maxCalls });
  if (error) throw new Error(`pending pairs failed: ${error.code ?? "unknown"}`);
  const pending = (data ?? []) as Pending[];
  stats.pending = pending.length;

  // Concurrency 2: Groq's free tier allows ~8,000 tokens/min, so more parallelism only buys 429s.
  await mapWithConcurrency(pending, 2, async (p) => {
    if (Date.now() > deadline) {
      stats.stopped_for_time = true;
      return;
    }
    try {
      const out = await scoreStance({ asset: { name: p.asset_name, asset_type: p.asset_type }, sentences: p.sentences }, opts.deps);
      stats.llm_calls += out.calls;
      if (out.kind === "skipped") {
        stats.skipped++;
        // "cap" also appears when llm_calls cannot be read (the budget check fails closed).
        stats.skip_reasons[out.reason] = (stats.skip_reasons[out.reason] ?? 0) + 1;
        return;
      }
      const v = stats.validation;
      v.answered++;
      if (out.row.status === "failed") {
        v.failed_after_retry++;
        if (out.row.failure_reason) bump(v.final_failure_reasons, out.row.failure_reason);
      } else if (out.firstFailure) v.retried_then_ok++;
      else v.first_attempt_ok++;
      if (out.firstFailure) bump(v.first_failure_reasons, out.firstFailure);
      if (out.row.status === "failed") console.warn(`[score] validation failed after retry: ${out.row.failure_reason}`);

      const { error: e } = await db.from("asset_signals").upsert({ article_id: p.article_id, asset_id: p.asset_id, ...out.row }, { onConflict: "article_id,asset_id", ignoreDuplicates: true });
      if (e) {
        console.error(`[score] save failed: ${e.code ?? "unknown"}`);
        return;
      }
      stats.saved++;
      stats[out.row.status]++;
    } catch {
      stats.skipped++;
      console.error("[score] unexpected failure for one pair");
    }
  });
  stats.validation = finaliseValidation(stats.validation);
  const v = stats.validation;
  if (v.answered) console.log(`[score] validation: ${v.answered} answered, ${v.first_attempt_ok} first-try ok, ${v.retried_then_ok} fixed by retry, ${v.failed_after_retry} failed`);
  return stats;
}
