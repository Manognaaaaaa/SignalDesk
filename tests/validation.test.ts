import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyIssues, clearLlmCache } from "@/lib/ai/llm";
import { scoreStance } from "@/lib/ai/stance";
import { buildSentences } from "@/lib/ingest/sentences";
import { finaliseValidation, runScoreStep } from "@/lib/jobs/score-job";
import { fakeClient, fakeDeps } from "./fixtures/helpers";

const gold = { name: "Gold", asset_type: "commodity" as const };
const sentences = buildSentences("Gold climbs to record high", "Bullion rose 1.2% as the dollar weakened.");
const j = (o: unknown) => JSON.stringify(o);
const GOOD = j({ stance: "bullish", strength: 3, evidence_ids: ["S1"], why: "Gold hit a record high." });
const BAD_CITATION = j({ stance: "bullish", strength: 3, evidence_ids: ["S9"], why: "Invented sentence." });
const BAD_ENUM = j({ stance: "hawkish", strength: 3, evidence_ids: ["S1"], why: "Wrong label for a commodity." });

beforeEach(() => clearLlmCache());

describe("validation failure classification", () => {
  it("classifies issues under citation fields as bad_citation, anything else as schema", () => {
    expect(classifyIssues([{ path: ["evidence_ids"] }])).toBe("bad_citation");
    expect(classifyIssues([{ path: ["bullets", 0, "article_ids"] }])).toBe("bad_citation");
    expect(classifyIssues([{ path: ["stance"] }, { path: ["why"] }])).toBe("schema");
  });

  it.each([
    ["not JSON", "Sure, here you go: bullish", "invalid_json"],
    ["an ID that is not in the input", BAD_CITATION, "bad_citation"],
    ["a stance not allowed for the asset type", BAD_ENUM, "schema"],
  ])("%s, then a valid answer -> saved ok, first failure recorded, audit row names the reason", async (_n, bad, reason) => {
    const { client } = fakeClient([bad, GOOD]);
    const { deps, logs } = fakeDeps(client);
    const out = await scoreStance({ asset: gold, sentences }, deps);
    expect(out).toMatchObject({ kind: "saved", firstFailure: reason, row: { status: "ok", stance: "bullish", failure_reason: null } });
    expect(logs.map((l) => [l.status, l.error])).toEqual([
      ["schema_retry", reason],
      ["ok", null],
    ]);
  });

  it("invalid twice -> saved as failed / unclear with the final reason (never dropped)", async () => {
    const { client } = fakeClient(["not json", BAD_CITATION]);
    const { deps, logs } = fakeDeps(client);
    const out = await scoreStance({ asset: gold, sentences }, deps);
    expect(out).toMatchObject({
      kind: "saved",
      calls: 2,
      firstFailure: "invalid_json",
      row: { status: "failed", stance: "unclear", strength: 0, evidence_ids: [], failure_reason: "bad_citation" },
    });
    expect(logs.map((l) => [l.status, l.error])).toEqual([
      ["schema_retry", "invalid_json"],
      ["failed", "bad_citation"],
    ]);
  });

  it("a valid first answer has no failure at all", async () => {
    const { client } = fakeClient([GOOD]);
    const { deps } = fakeDeps(client);
    const out = await scoreStance({ asset: gold, sentences }, deps);
    expect(out).toMatchObject({ kind: "saved", firstFailure: null, row: { failure_reason: null } });
  });
});

/** Minimal stand-in for the Supabase client used by runScoreStep. */
function fakeDb(pending: unknown[]) {
  const saved: Record<string, unknown>[] = [];
  const db = {
    rpc: async () => ({ data: pending, error: null }),
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        saved.push(row);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { db, saved };
}

describe("per-run validation stats", () => {
  it("counts first-try passes, retries that fixed it and final failures; failed rows carry a reason", async () => {
    const pair = (i: number) => ({ article_id: `a${i}`, asset_id: "gold", asset_name: "Gold", asset_type: "commodity", sentences });
    // Distinct sentences per pair so the prompt-hash cache does not collapse them.
    const pending = [0, 1, 2].map((i) => ({ ...pair(i), sentences: buildSentences(`Gold climbs ${i}`, "Bullion rose.") }));
    const { client } = fakeClient([GOOD, BAD_ENUM, GOOD, "nope", BAD_CITATION]);
    const { deps } = fakeDeps(client);
    const { db, saved } = fakeDb(pending);
    // Scoring runs 2 pairs at a time, so which pair gets which answer varies; the invariants below do not.
    const stats = await runScoreStep(db, { hasKey: true, maxCalls: 10, timeBudgetMs: 60_000, deps });
    const v = stats.validation;
    expect(v.answered).toBe(3);
    expect(v.first_attempt_ok + v.retried_then_ok + v.failed_after_retry).toBe(3);
    expect(v.failed_after_retry).toBe(stats.failed);
    expect(saved).toHaveLength(3);
    for (const r of saved) expect(r.status === "failed" ? r.failure_reason : r.failure_reason === null).toBeTruthy();
    expect(v.first_attempt_pass_rate).toBeCloseTo(v.first_attempt_ok / 3, 3);
  });

  it("rates are null when nothing was answered, and exact otherwise", () => {
    const empty = finaliseValidation({ answered: 0, first_attempt_ok: 0, retried_then_ok: 0, failed_after_retry: 0, first_failure_reasons: {}, final_failure_reasons: {}, first_attempt_pass_rate: null, retry_rate: null, failure_rate: null });
    expect([empty.first_attempt_pass_rate, empty.retry_rate, empty.failure_rate]).toEqual([null, null, null]);
    const v = finaliseValidation({ ...empty, answered: 8, first_attempt_ok: 6, retried_then_ok: 1, failed_after_retry: 1 });
    expect([v.first_attempt_pass_rate, v.retry_rate, v.failure_rate]).toEqual([0.75, 0.25, 0.125]);
  });
});
