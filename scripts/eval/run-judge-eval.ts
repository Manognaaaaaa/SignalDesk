/**
 * npm run eval:judge [-- options]
 *
 * Runs the PRODUCTION Judge (scoreStance: same prompt version, schema, retry and fallback) on the
 * hand-labelled set in eval/judge/labels.csv and reports:
 *   - accuracy, macro F1, per-class precision/recall/F1, confusion matrix, slices by asset type / bucket
 *   - citation validity (cited IDs exist in the input) and first-attempt schema pass rate
 *   - overlap of cited IDs with your gold_supporting_sentence_ids
 *   - citation SUPPORT via an LLM-as-judge with a strict rubric (src/lib/eval/citation-judge.ts)
 * Writes eval/results/<timestamp>_<model>_<prompt>.{json,md} (+ _spotcheck.md with --spot-check).
 *
 * Options:
 *   --labels <csv>        default eval/judge/labels.csv
 *   --model <id>          Judge model (default GROQ_MODEL or openai/gpt-oss-120b)
 *   --prompt <version>    stance prompt version (default STANCE_PROMPT_VERSION or v1)
 *   --judge-model <id>    citation-support judge (default qwen/qwen3.8-27b: a different model family)
 *   --no-support          skip the citation-support judge
 *   --spot-check [n]      dump n (default 30) random support judgements for hand review
 *   --limit <n>           only the first n labelled examples (smoke test)
 *   --out-dir <dir>       default eval/results
 *   --no-cache            ignore eval/.cache (answers are cached on disk so re-runs cost nothing)
 *
 * Needs GROQ_API_KEY. No database access: calls are counted locally, not written to llm_calls.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Groq from "groq-sdk";
import type { LlmCallRecord, LlmDeps } from "@/lib/ai/llm";
import { getStancePrompt, templateHash } from "@/lib/ai/stance-prompts";
import { scoreStance, type StanceOutcome } from "@/lib/ai/stance";
import { CITATION_JUDGE_VERSION, citationJudgeHash, judgeCitations, type Judgement } from "@/lib/eval/citation-judge";
import { parseCsv } from "@/lib/eval/csv";
import { readLabelled, type LabelledExample } from "@/lib/eval/judge-dataset";
import { citationOverlap, classificationReport, fmtPct, type ClassificationReport } from "@/lib/eval/metrics";
import { seededRandom, shuffle } from "@/lib/eval/sampling";
import { parseArgs } from "../lib/env";

const CLASSES = ["bullish", "bearish", "hawkish", "dovish", "neutral", "unclear"] as const;
const CACHE_DIR = "eval/.cache";
const HTTP_RETRY_WAIT_MS = 20_000;
const HTTP_RETRIES = 4;

type CacheEntry<T> = { key: string; value: T; latency_ms: number; first_attempt_ok: boolean };

class DiskCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  constructor(private file: string, enabled: boolean) {
    if (enabled && existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as CacheEntry<T>;
          this.map.set(e.key, e);
        } catch {
          /* ignore a torn last line */
        }
      }
    }
  }
  get(key: string) {
    return this.map.get(key);
  }
  set(e: CacheEntry<T>) {
    this.map.set(e.key, e);
    appendFileSync(this.file, `${JSON.stringify(e)}\n`);
  }
}

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const slug = (s: string) => s.replace(/[^a-z0-9.]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

function gitRev(): string {
  try {
    const rev = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== "";
    return dirty ? `${rev}-dirty` : rev;
  } catch {
    return "unknown";
  }
}

function makeDeps(groq: Groq, model: string, calls: LlmCallRecord[]): LlmDeps {
  return {
    client: { create: (body, opts) => groq.chat.completions.create(body as never, { signal: opts.signal }) as never },
    model,
    promptVersion: "eval",
    priceInPerM: Number(process.env.GROQ_PRICE_IN_PER_M || 0.15),
    priceOutPerM: Number(process.env.GROQ_PRICE_OUT_PER_M || 0.75),
    maxCallsPerDay: 100_000,
    countCallsToday: async () => 0,
    logCall: async (r) => {
      calls.push(r);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    timeoutMs: 30_000,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries calls that were skipped for rate limits / network (never schema failures) after a pause. */
async function withHttpRetry<T extends { kind?: string; ok?: boolean; reason?: string }>(fn: () => Promise<T>, isRetryable: (r: T) => boolean): Promise<T> {
  let r = await fn();
  for (let i = 0; i < HTTP_RETRIES && isRetryable(r); i++) {
    process.stdout.write("~");
    await sleep(HTTP_RETRY_WAIT_MS);
    r = await fn();
  }
  return r;
}

type Row = {
  example_id: string;
  asset: string;
  asset_type: string;
  source: string;
  bucket: string;
  gold: string;
  gold_ids: string[];
  pred: string;
  status: string;
  strength: number | null;
  evidence_ids: string[];
  why: string;
  citation_valid: boolean | null;
  first_attempt_ok: boolean | null;
  latency_ms: number;
  cached: boolean;
  support: Judgement[] | null;
  support_error: string | null;
};

function sliceAccuracy(rows: Row[], key: "asset_type" | "bucket" | "source") {
  const out: Record<string, { n: number; correct: number; accuracy: number | null }> = {};
  for (const r of rows) {
    const o = (out[r[key]] ??= { n: 0, correct: 0, accuracy: null });
    o.n++;
    if (r.pred === r.gold) o.correct++;
  }
  for (const o of Object.values(out)) o.accuracy = o.n ? o.correct / o.n : null;
  return out;
}

function confusionMd(rep: ClassificationReport): string {
  const head = `| gold \\ predicted | ${rep.labels_pred.join(" | ")} | total |`;
  const sep = `|---|${rep.labels_pred.map(() => "---:").join("|")}|---:|`;
  const body = rep.labels_gold.map((g) => {
    const cells = rep.labels_pred.map((p) => {
      const v = rep.matrix[g]![p]!;
      return g === p ? `**${v}**` : String(v);
    });
    return `| ${g} | ${cells.join(" | ")} | ${rep.labels_pred.reduce((a, p) => a + rep.matrix[g]![p]!, 0)} |`;
  });
  return [head, sep, ...body].join("\n");
}

async function main() {
  const args = parseArgs();
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    console.error("GROQ_API_KEY is not set: the Judge eval needs the model.");
    process.exit(1);
  }
  const labelsPath = typeof args.labels === "string" ? args.labels : "eval/judge/labels.csv";
  const model = typeof args.model === "string" ? args.model : process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
  const prompt = getStancePrompt(typeof args.prompt === "string" ? args.prompt : process.env.STANCE_PROMPT_VERSION?.trim() || "v1");
  const judgeModel = typeof args["judge-model"] === "string" ? args["judge-model"] : "qwen/qwen3.8-27b";
  const doSupport = !args["no-support"];
  const spotN = args["spot-check"] === undefined ? 0 : args["spot-check"] === true ? 30 : Number(args["spot-check"]);
  const useCache = !args["no-cache"];
  const limit = args.limit === undefined ? Infinity : Number(args.limit);
  const outDir = typeof args["out-dir"] === "string" ? args["out-dir"] : "eval/results";

  if (!existsSync(labelsPath)) {
    console.error(`${labelsPath} not found. Create it with: npm run eval:sample`);
    process.exit(1);
  }
  const { labelled: all, unlabelled, skipped, problems } = readLabelled(parseCsv(readFileSync(labelsPath, "utf8")));
  if (problems.length) {
    console.error(`Fix these rows in ${labelsPath} first:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const examples: LabelledExample[] = all.slice(0, limit);
  if (!examples.length) {
    console.error(`No labelled rows in ${labelsPath} yet (${unlabelled} unlabelled). Fill gold_stance, see eval/LABELLING_GUIDE.md.`);
    process.exit(1);
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const stanceCache = new DiskCache<StanceOutcome>(`${CACHE_DIR}/stance.jsonl`, useCache);
  const supportCache = new DiskCache<Judgement[]>(`${CACHE_DIR}/citation-judge.jsonl`, useCache);
  const groq = new Groq({ apiKey: key, maxRetries: 0 });
  const stanceCalls: LlmCallRecord[] = [];
  const judgeCalls: LlmCallRecord[] = [];
  const stanceDeps = makeDeps(groq, model, stanceCalls);
  const judgeDeps = makeDeps(groq, judgeModel, judgeCalls);
  const promptHash = templateHash(prompt);
  const started = new Date();

  console.log(`Judge eval: ${examples.length} labelled examples · ${model} · prompt ${prompt.version} (${promptHash})${doSupport ? ` · support judge ${judgeModel}` : ""}`);
  const rows: Row[] = [];
  for (const ex of examples) {
    const input = { asset: { name: ex.asset, asset_type: ex.asset_type }, sentences: ex.sentences };
    const ck = sha(["stance", model, promptHash, input]);
    let out: StanceOutcome;
    let latency: number;
    let firstOk: boolean;
    const hit = stanceCache.get(ck);
    if (hit) {
      out = hit.value;
      latency = hit.latency_ms;
      firstOk = hit.first_attempt_ok;
    } else {
      const before = stanceCalls.length;
      const t0 = Date.now();
      out = await withHttpRetry(
        () => scoreStance(input, stanceDeps, prompt),
        (r) => r.kind === "skipped",
      );
      latency = Date.now() - t0;
      firstOk = !stanceCalls.slice(before).some((c) => c.status === "schema_retry");
      if (out.kind === "saved") stanceCache.set({ key: ck, value: out, latency_ms: latency, first_attempt_ok: firstOk });
    }

    const ids = new Set(ex.sentences.map((s) => s.id));
    const saved = out.kind === "saved" ? out.row : null;
    const pred = !saved ? "skipped" : saved.status === "failed" ? "validation_failed" : saved.stance;
    const row: Row = {
      example_id: ex.example_id,
      asset: ex.asset,
      asset_type: ex.asset_type,
      source: ex.source,
      bucket: ex.bucket,
      gold: ex.gold_stance,
      gold_ids: ex.gold_ids,
      pred,
      status: saved?.status ?? "skipped",
      strength: saved?.strength ?? null,
      evidence_ids: saved?.evidence_ids ?? [],
      why: saved?.why ?? "",
      citation_valid: saved && saved.status !== "failed" ? saved.evidence_ids.length > 0 && saved.evidence_ids.every((id) => ids.has(id)) : null,
      first_attempt_ok: saved ? firstOk : null,
      latency_ms: latency,
      cached: Boolean(hit),
      support: null,
      support_error: null,
    };

    // Support is judged for directional and neutral answers; an "unclear" answer claims no stance to support.
    if (doSupport && saved && saved.status === "ok" && saved.evidence_ids.length) {
      const jin = { asset: input.asset, stance: saved.stance, cited: saved.evidence_ids, sentences: ex.sentences };
      const jk = sha(["support", judgeModel, citationJudgeHash(), jin]);
      const jh = supportCache.get(jk);
      if (jh) row.support = jh.value;
      else {
        const t0 = Date.now();
        const jr = await withHttpRetry(
          () => judgeCitations(jin, judgeDeps),
          (r) => !r.ok && r.reason !== "schema",
        );
        if (jr.ok) {
          row.support = jr.judgements;
          supportCache.set({ key: jk, value: jr.judgements, latency_ms: Date.now() - t0, first_attempt_ok: true });
        } else row.support_error = jr.reason;
      }
    }
    rows.push(row);
    process.stdout.write(row.pred === row.gold ? "." : "x");
  }
  console.log("");

  // ---- metrics
  const report = classificationReport(
    rows.map((r) => ({ gold: r.gold, pred: r.pred })),
    CLASSES,
  );
  const withOutput = rows.filter((r) => r.citation_valid !== null);
  const attempted = rows.filter((r) => r.first_attempt_ok !== null);
  const overlapItems = rows.filter((r) => r.gold !== "unclear" && r.gold_ids.length && r.citation_valid);
  const overlap = citationOverlap(overlapItems.map((r) => ({ predicted: r.evidence_ids, gold: r.gold_ids })));
  const judged = rows.filter((r) => r.support);
  const sentences = judged.flatMap((r) => r.support!);
  const count = (v: string) => sentences.filter((j) => j.verdict === v).length;
  const fully = judged.filter((r) => r.support!.every((j) => j.verdict === "supports")).length;
  const judgedCorrect = judged.filter((r) => r.pred === r.gold);
  const sumCost = (cs: LlmCallRecord[]) => Number(cs.reduce((a, c) => a + (c.est_cost_usd ?? 0), 0).toFixed(6));
  const fresh = rows.filter((r) => !r.cached);

  const summary = {
    run_at: started.toISOString(),
    git: gitRev(),
    labels_file: labelsPath,
    dataset_fingerprint: sha(examples.map((e) => [e.example_id, e.gold_stance, e.gold_ids, e.sentences])).slice(0, 12),
    examples: rows.length,
    unlabelled_rows: unlabelled,
    skipped_rows: skipped,
    model,
    prompt_version: prompt.version,
    prompt_template_hash: promptHash,
    accuracy: report.accuracy,
    macro_f1: report.macro_f1,
    macro_f1_classes: report.macro_f1_classes,
    per_class: report.per_class,
    confusion: { labels_gold: report.labels_gold, labels_pred: report.labels_pred, matrix: report.matrix },
    by_asset_type: sliceAccuracy(rows, "asset_type"),
    by_bucket: sliceAccuracy(rows, "bucket"),
    by_source: sliceAccuracy(rows, "source"),
    validation_failed: rows.filter((r) => r.pred === "validation_failed").length,
    skipped_calls: rows.filter((r) => r.pred === "skipped").length,
    citation_validity: { n: withOutput.length, rate: withOutput.length ? withOutput.filter((r) => r.citation_valid).length / withOutput.length : null },
    first_attempt_schema_pass: { n: attempted.length, rate: attempted.length ? attempted.filter((r) => r.first_attempt_ok).length / attempted.length : null },
    gold_evidence_overlap: overlap,
    citation_support: doSupport
      ? {
          judge_model: judgeModel,
          judge_version: CITATION_JUDGE_VERSION,
          judge_prompt_hash: citationJudgeHash(),
          examples_judged: judged.length,
          judge_failures: rows.filter((r) => r.support_error).length,
          cited_sentences: sentences.length,
          supports: count("supports"),
          partial: count("partial"),
          does_not_support: count("does_not_support"),
          sentence_support_rate: sentences.length ? count("supports") / sentences.length : null,
          examples_fully_supported_rate: judged.length ? fully / judged.length : null,
          sentence_support_rate_when_correct: judgedCorrect.length
            ? judgedCorrect.flatMap((r) => r.support!).filter((j) => j.verdict === "supports").length / judgedCorrect.flatMap((r) => r.support!).length
            : null,
        }
      : null,
    cost_latency: {
      fresh_examples: fresh.length,
      cached_examples: rows.length - fresh.length,
      avg_latency_ms: fresh.length ? Math.round(fresh.reduce((a, r) => a + r.latency_ms, 0) / fresh.length) : null,
      stance_calls: stanceCalls.length,
      stance_schema_retries: stanceCalls.filter((c) => c.status === "schema_retry").length,
      stance_rate_limited: stanceCalls.filter((c) => c.status === "rate_limited").length,
      stance_cost_usd: sumCost(stanceCalls),
      judge_calls: judgeCalls.length,
      judge_cost_usd: sumCost(judgeCalls),
      note: "Costs cover calls made in this run only; cached answers cost nothing. Prices are the GROQ_PRICE_* estimates.",
    },
  };

  // ---- write
  mkdirSync(outDir, { recursive: true });
  const stamp = started.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const base = `${outDir}/${stamp}_${slug(model)}_${prompt.version}`;
  writeFileSync(`${base}.json`, JSON.stringify({ summary, rows }, null, 2));

  const pc = report.per_class;
  const cs = summary.citation_support;
  const md = [
    `# Judge eval · ${started.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `- **Model:** \`${model}\` · **stance prompt:** \`${prompt.version}\` (template \`${promptHash}\`)`,
    `- **Dataset:** ${rows.length} labelled examples from \`${labelsPath}\` (fingerprint \`${summary.dataset_fingerprint}\`; ${skipped} rows marked skip, ${unlabelled} unlabelled) · **commit** \`${summary.git}\``,
    cs ? `- **Citation-support judge:** \`${judgeModel}\` · rubric \`${CITATION_JUDGE_VERSION}\` (\`${cs.judge_prompt_hash}\`)` : "- Citation-support judge: not run (--no-support)",
    "",
    "## Headline",
    "",
    "| Metric | Value | n |",
    "|---|---:|---:|",
    `| Accuracy | **${fmtPct(report.accuracy)}** | ${report.n} |`,
    `| Macro F1 (over ${report.macro_f1_classes.length} gold classes) | **${fmtPct(report.macro_f1)}** | ${report.n} |`,
    `| Citation validity (cited IDs exist in input) | ${fmtPct(summary.citation_validity.rate)} | ${summary.citation_validity.n} |`,
    `| First-attempt schema pass (before the retry) | ${fmtPct(summary.first_attempt_schema_pass.rate)} | ${summary.first_attempt_schema_pass.n} |`,
    `| Validation failed after retry | ${summary.validation_failed} | ${report.n} |`,
    cs ? `| Citation support: cited sentences judged "supports" | **${fmtPct(cs.sentence_support_rate)}** | ${cs.cited_sentences} sentences |` : null,
    cs ? `| Citation support: examples with every citation "supports" | ${fmtPct(cs.examples_fully_supported_rate)} | ${cs.examples_judged} |` : null,
    `| Cited IDs vs your gold IDs: precision / recall | ${fmtPct(overlap.precision)} / ${fmtPct(overlap.recall)} | ${overlap.n} |`,
    "",
    "## Per class",
    "",
    "| Class | Support | Predicted | Precision | Recall | F1 |",
    "|---|---:|---:|---:|---:|---:|",
    ...Object.entries(pc).map(([c, s]) => `| ${c} | ${s.support} | ${s.predicted} | ${fmtPct(s.precision)} | ${fmtPct(s.recall)} | ${fmtPct(s.f1)} |`),
    "",
    "## Confusion matrix",
    "",
    "Rows are your labels, columns are the model's answers. `validation_failed` = invalid output twice (recorded as unclear/failed in production and excluded from the mood); `skipped` = the call never completed.",
    "",
    confusionMd(report),
    "",
    "## Slices",
    "",
    "| Slice | Value | n | Accuracy |",
    "|---|---|---:|---:|",
    ...Object.entries(summary.by_asset_type).map(([k, v]) => `| asset type | ${k} | ${v.n} | ${fmtPct(v.accuracy)} |`),
    ...Object.entries(summary.by_bucket).map(([k, v]) => `| bucket | ${k} | ${v.n} | ${fmtPct(v.accuracy)} |`),
    ...Object.entries(summary.by_source).map(([k, v]) => `| source | ${k} | ${v.n} | ${fmtPct(v.accuracy)} |`),
    "",
    ...(cs
      ? [
          "## Citation support detail",
          "",
          `${cs.cited_sentences} cited sentences across ${cs.examples_judged} examples with a non-unclear answer: ${cs.supports} supports, ${cs.partial} partial, ${cs.does_not_support} do not support (${cs.judge_failures} judge failures). Only "supports" counts. Among correct answers, ${fmtPct(cs.sentence_support_rate_when_correct)} of cited sentences support the stance.`,
          "",
        ]
      : []),
    "## Misses",
    "",
    ...(rows.filter((r) => r.pred !== r.gold).length
      ? ["| example | asset | gold | predicted | why (model) |", "|---|---|---|---|---|", ...rows.filter((r) => r.pred !== r.gold).slice(0, 60).map((r) => `| ${r.example_id} | ${r.asset} | ${r.gold} | ${r.pred} | ${r.why.replace(/\|/g, "/")} |`)]
      : ["None."]),
    "",
    "## Cost and latency (this run)",
    "",
    `${summary.cost_latency.fresh_examples} examples called the model, ${summary.cost_latency.cached_examples} came from the cache. Avg Judge latency ${summary.cost_latency.avg_latency_ms ?? "–"} ms. Judge: ${summary.cost_latency.stance_calls} calls (${summary.cost_latency.stance_schema_retries} schema retries, ${summary.cost_latency.stance_rate_limited} rate-limited), est $${summary.cost_latency.stance_cost_usd}. Support judge: ${summary.cost_latency.judge_calls} calls, est $${summary.cost_latency.judge_cost_usd}.`,
    "",
    "## Read this honestly",
    "",
    `- ${rows.length} examples, labelled by one person (the author). Per-class numbers with small support are noisy.`,
    "- Citation support is itself an LLM judgement: check it with the spot-check file before quoting it.",
    `- The sample is stratified across assets and sources and ${fmtPct(rows.filter((r) => r.bucket !== "standard").length / rows.length, 0)} are harder cases (asset not in the headline, or 3+ assets), so accuracy is not the accuracy on the live feed mix.`,
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
  writeFileSync(`${base}.md`, `${md}\n`);

  if (spotN > 0 && sentences.length) {
    const rand = seededRandom(7);
    const pool = judged.flatMap((r) => r.support!.map((j) => ({ r, j })));
    const pick = shuffle(pool, rand).slice(0, spotN);
    const exById = new Map(examples.map((e) => [e.example_id, e]));
    const lines = [
      `# Citation-support spot check · ${pick.length} random judgements`,
      "",
      `Judge \`${judgeModel}\` (${CITATION_JUDGE_VERSION}) on the answers of \`${model}\` / \`${prompt.version}\`. For each, tick whether you agree with the judge's verdict, then count agreements to estimate the judge's own accuracy.`,
      "",
    ];
    pick.forEach(({ r, j }, i) => {
      const ex = exById.get(r.example_id)!;
      lines.push(
        `## ${i + 1}. ${r.asset} · model said **${r.pred}** · cited ${r.evidence_ids.join(", ")}`,
        "",
        ...ex.sentences.map((s) => `- ${s.id === j.id ? "**→** " : ""}\`${s.id}\` ${s.text}`),
        "",
        `Judged sentence **${j.id}**: **${j.verdict}**, "${j.reason}"`,
        "",
        "- [ ] I agree  - [ ] I disagree (correct verdict: ______ )",
        "",
      );
    });
    writeFileSync(`${base}_spotcheck.md`, lines.join("\n"));
    console.log(`Spot check: ${base}_spotcheck.md`);
  }

  console.log(`Accuracy ${fmtPct(report.accuracy)} · macro F1 ${fmtPct(report.macro_f1)} · citation validity ${fmtPct(summary.citation_validity.rate)}${cs ? ` · citation support ${fmtPct(cs.sentence_support_rate)}` : ""} (n=${report.n})`);
  console.log(`Wrote ${base}.json and ${base}.md`);
}

main().catch((e) => {
  console.error(`judge eval failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
