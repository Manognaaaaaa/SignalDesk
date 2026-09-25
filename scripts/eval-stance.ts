/**
 * npm run eval
 * Runs the PRODUCTION stance step (scoreStance: same prompts, schema and checks) on every case in
 * eval/stance_cases.json and reports accuracy, per-stance accuracy, how often it correctly says
 * "unclear", evidence validity (must be 100%), latency and cost. Writes eval/results.json.
 * Needs GROQ_API_KEY; no database access (calls are counted locally, not logged to llm_calls).
 */
import { readFileSync, writeFileSync } from "node:fs";
import Groq from "groq-sdk";
import { z } from "zod";
import type { AssetType } from "@/config/assets-seed";
import { type LlmCallRecord, type LlmDeps } from "@/lib/ai/llm";
import { scoreStance } from "@/lib/ai/stance";

const caseSchema = z.object({
  id: z.string(),
  asset: z.object({ name: z.string(), asset_type: z.enum(["currency_pair", "commodity", "index", "stock", "crypto", "central_bank"]) }),
  expected: z.enum(["bullish", "bearish", "hawkish", "dovish", "neutral", "unclear"]),
  sentences: z.array(z.string().min(1)).min(1).max(6),
});
const fileSchema = z.object({ cases: z.array(caseSchema).min(1) });

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    console.log("GROQ_API_KEY is not set: the stance eval needs the model. Nothing to do.");
    return;
  }
  const { cases } = fileSchema.parse(JSON.parse(readFileSync("eval/stance_cases.json", "utf8")));
  const groq = new Groq({ apiKey: key, maxRetries: 0 });
  const calls: LlmCallRecord[] = [];
  const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
  const deps: LlmDeps = {
    client: { create: (body, opts) => groq.chat.completions.create(body as never, { signal: opts.signal }) as never },
    model,
    promptVersion: process.env.PROMPT_VERSION?.trim() || "v1",
    priceInPerM: Number(process.env.GROQ_PRICE_IN_PER_M ?? 0.15),
    priceOutPerM: Number(process.env.GROQ_PRICE_OUT_PER_M ?? 0.75),
    maxCallsPerDay: 10_000,
    countCallsToday: async () => 0,
    logCall: async (r) => {
      calls.push(r);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    timeoutMs: 15_000,
  };

  const rows: { id: string; asset: string; expected: string; predicted: string; status: string; correct: boolean; evidence_valid: boolean | null; latency_ms: number; why: string }[] = [];
  for (const c of cases) {
    const sentences = c.sentences.map((text, i) => ({ id: `S${i + 1}`, text }));
    const t0 = Date.now();
    const out = await scoreStance({ asset: { name: c.asset.name, asset_type: c.asset.asset_type as AssetType }, sentences }, deps);
    const latency = Date.now() - t0;
    if (out.kind === "skipped") {
      rows.push({ id: c.id, asset: c.asset.name, expected: c.expected, predicted: `skipped:${out.reason}`, status: "skipped", correct: false, evidence_valid: null, latency_ms: latency, why: "" });
    } else {
      const ids = new Set(sentences.map((s) => s.id));
      const valid = out.row.status === "failed" ? null : out.row.evidence_ids.length > 0 && out.row.evidence_ids.every((id) => ids.has(id));
      rows.push({ id: c.id, asset: c.asset.name, expected: c.expected, predicted: out.row.stance, status: out.row.status, correct: out.row.status !== "failed" && out.row.stance === c.expected, evidence_valid: valid, latency_ms: latency, why: out.row.why });
    }
    process.stdout.write(rows.at(-1)!.correct ? "." : "x");
  }
  console.log("");

  const labels = ["bullish", "bearish", "hawkish", "dovish", "neutral", "unclear"];
  const perStance = Object.fromEntries(
    labels.map((l) => {
      const xs = rows.filter((r) => r.expected === l);
      return [l, { cases: xs.length, correct: xs.filter((r) => r.correct).length, accuracy: xs.length ? xs.filter((r) => r.correct).length / xs.length : null }];
    }),
  );
  const unclearCases = rows.filter((r) => r.expected === "unclear");
  const saidUnclear = rows.filter((r) => r.predicted === "unclear");
  const scored = rows.filter((r) => r.evidence_valid !== null);
  const okCalls = calls.filter((c) => c.status === "ok" || c.status === "schema_retry");
  const summary = {
    model,
    prompt_version: deps.promptVersion,
    cases: rows.length,
    accuracy: rows.filter((r) => r.correct).length / rows.length,
    per_stance: perStance,
    unclear_recall: unclearCases.length ? unclearCases.filter((r) => r.predicted === "unclear").length / unclearCases.length : null,
    unclear_precision: saidUnclear.length ? saidUnclear.filter((r) => r.expected === "unclear").length / saidUnclear.length : null,
    evidence_validity: scored.length ? scored.filter((r) => r.evidence_valid).length / scored.length : null,
    failed: rows.filter((r) => r.status === "failed").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    avg_latency_ms: Math.round(rows.reduce((a, r) => a + r.latency_ms, 0) / rows.length),
    llm_calls: calls.length,
    schema_retries: calls.filter((c) => c.status === "schema_retry").length,
    rate_limited_retries: calls.filter((c) => c.status === "rate_limited").length,
    input_tokens: okCalls.reduce((a, c) => a + (c.input_tokens ?? 0), 0),
    output_tokens: okCalls.reduce((a, c) => a + (c.output_tokens ?? 0), 0),
    est_cost_usd: Number(calls.reduce((a, c) => a + (c.est_cost_usd ?? 0), 0).toFixed(6)),
    run_at: new Date().toISOString(),
  };
  writeFileSync("eval/results.json", JSON.stringify({ summary, rows }, null, 2));

  console.log(`\nModel ${model} · ${rows.length} cases`);
  console.table(Object.fromEntries(Object.entries(perStance).map(([k, v]) => [k, { cases: v.cases, correct: v.correct, accuracy: v.accuracy === null ? "-" : pct(v.accuracy) }])));
  console.log(`Accuracy ${pct(summary.accuracy)} · unclear recall ${summary.unclear_recall === null ? "-" : pct(summary.unclear_recall)} · unclear precision ${summary.unclear_precision === null ? "-" : pct(summary.unclear_precision)}`);
  console.log(`Evidence validity ${summary.evidence_validity === null ? "-" : pct(summary.evidence_validity)} · failed ${summary.failed} · skipped ${summary.skipped}`);
  console.log(`Avg latency ${summary.avg_latency_ms} ms · ${summary.llm_calls} calls (${summary.schema_retries} schema retries, ${summary.rate_limited_retries} rate-limited) · ${summary.input_tokens}/${summary.output_tokens} tokens · est $${summary.est_cost_usd}`);
  const misses = rows.filter((r) => !r.correct);
  if (misses.length) {
    console.log("\nMisses:");
    for (const m of misses) console.log(`  ${m.id} ${m.asset}: expected ${m.expected}, got ${m.predicted} (${m.status}) ${m.why}`);
  }
  console.log("\nWrote eval/results.json");
}

main().catch((e) => {
  console.error(`eval failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
