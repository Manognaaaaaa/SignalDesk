import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetType } from "@/config/assets-seed";
import type { LlmDeps } from "@/lib/ai/llm";
import { scoreStance } from "@/lib/ai/stance";
import { mapWithConcurrency } from "@/lib/ingest/feeds";
import type { Sentence } from "@/lib/ingest/sentences";

/**
 * Step 5: stance scoring. Takes up to MAX_STANCE_CALLS_PER_RUN unscored (article, asset) pairs,
 * newest first, and scores each with ONE model call. Pairs not reached (cap, time budget, no key,
 * transient errors) simply wait for the next run. One failure never stops the loop.
 */

export type ScoreStats = { ai_offline: boolean; pending: number; saved: number; ok: number; unclear: number; failed: number; skipped: number; llm_calls: number; stopped_for_time: boolean };

type Pending = { article_id: string; asset_id: string; asset_name: string; asset_type: AssetType; sentences: Sentence[] };

export async function runScoreStep(db: SupabaseClient, opts: { hasKey: boolean; maxCalls: number; timeBudgetMs: number; deps?: LlmDeps }): Promise<ScoreStats> {
  const stats: ScoreStats = { ai_offline: !opts.hasKey, pending: 0, saved: 0, ok: 0, unclear: 0, failed: 0, skipped: 0, llm_calls: 0, stopped_for_time: false };
  if (!opts.hasKey || opts.maxCalls <= 0) return stats;
  const deadline = Date.now() + opts.timeBudgetMs;

  const { data, error } = await db.rpc("pending_signal_pairs", { p_limit: opts.maxCalls });
  if (error) throw new Error(`pending pairs failed: ${error.code ?? "unknown"}`);
  const pending = (data ?? []) as Pending[];
  stats.pending = pending.length;

  await mapWithConcurrency(pending, 3, async (p) => {
    if (Date.now() > deadline) {
      stats.stopped_for_time = true;
      return;
    }
    try {
      const out = await scoreStance({ asset: { name: p.asset_name, asset_type: p.asset_type }, sentences: p.sentences }, opts.deps);
      stats.llm_calls += out.calls;
      if (out.kind === "skipped") {
        stats.skipped++;
        return;
      }
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
  return stats;
}
