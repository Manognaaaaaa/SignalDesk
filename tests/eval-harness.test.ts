import { describe, expect, it } from "vitest";
import { citationJudgeSchema } from "@/lib/eval/citation-judge";
import { parseCsv, toCsv } from "@/lib/eval/csv";
import { formatSentences, JUDGE_COLUMNS, parseSentences, readLabelled } from "@/lib/eval/judge-dataset";
import { citationOverlap, classificationReport } from "@/lib/eval/metrics";
import { seededRandom, stratifiedSample, type Candidate } from "@/lib/eval/sampling";

const CLASSES = ["bullish", "bearish", "hawkish", "dovish", "neutral", "unclear"];

describe("classificationReport", () => {
  // Hand-computed: gold bullish x3, bearish x2, unclear x1.
  const pairs = [
    { gold: "bullish", pred: "bullish" },
    { gold: "bullish", pred: "bullish" },
    { gold: "bullish", pred: "unclear" },
    { gold: "bearish", pred: "bearish" },
    { gold: "bearish", pred: "bullish" },
    { gold: "unclear", pred: "validation_failed" },
  ];
  const r = classificationReport(pairs, CLASSES);

  it("accuracy counts non-stance predictions as wrong", () => {
    expect(r.n).toBe(6);
    expect(r.correct).toBe(3);
    expect(r.accuracy).toBeCloseTo(0.5);
  });

  it("per-class precision / recall / F1", () => {
    // bullish: tp 2, predicted 3, support 3 -> P 2/3, R 2/3, F1 2/3
    expect(r.per_class.bullish!.precision).toBeCloseTo(2 / 3);
    expect(r.per_class.bullish!.recall).toBeCloseTo(2 / 3);
    expect(r.per_class.bullish!.f1).toBeCloseTo(2 / 3);
    // bearish: tp 1, predicted 1, support 2 -> P 1, R 0.5, F1 2/3
    expect(r.per_class.bearish!.precision).toBe(1);
    expect(r.per_class.bearish!.recall).toBe(0.5);
    expect(r.per_class.bearish!.f1).toBeCloseTo(2 / 3);
    // unclear: tp 0, predicted 1, support 1 -> F1 0
    expect(r.per_class.unclear!.f1).toBe(0);
  });

  it("macro F1 averages over gold classes only", () => {
    expect(r.macro_f1_classes).toEqual(["bullish", "bearish", "unclear"]);
    expect(r.macro_f1).toBeCloseTo((2 / 3 + 2 / 3 + 0) / 3);
  });

  it("confusion matrix has gold rows and an extra column for validation failures", () => {
    expect(r.labels_gold).toEqual(["bullish", "bearish", "unclear"]);
    expect(r.labels_pred).toEqual(["bullish", "bearish", "unclear", "validation_failed"]);
    expect(r.matrix.bullish).toEqual({ bullish: 2, bearish: 0, unclear: 1, validation_failed: 0 });
    expect(r.matrix.bearish!.bullish).toBe(1);
    expect(r.matrix.unclear!.validation_failed).toBe(1);
  });

  it("a class never predicted gets F1 0, and empty input gives null", () => {
    const x = classificationReport([{ gold: "neutral", pred: "bullish" }], CLASSES);
    expect(x.per_class.neutral!.f1).toBe(0);
    expect(x.per_class.neutral!.precision).toBeNull();
    expect(classificationReport([], CLASSES).accuracy).toBeNull();
  });
});

describe("citationOverlap", () => {
  it("is micro-averaged over IDs", () => {
    const o = citationOverlap([
      { predicted: ["S1", "S2"], gold: ["S1"] },
      { predicted: ["S3"], gold: ["S3", "S4"] },
    ]);
    expect(o.precision).toBeCloseTo(2 / 3);
    expect(o.recall).toBeCloseTo(2 / 3);
  });
});

describe("csv", () => {
  it("round-trips quotes, commas and newlines", () => {
    const rows = [{ a: 'he said "hi", then left', b: "[S1] one\n[S2] two" }];
    expect(parseCsv(toCsv(["a", "b"], rows))).toEqual(rows);
  });
});

describe("judge dataset", () => {
  const sentences = [
    { id: "S1", text: "Gold jumps 2%." },
    { id: "S2", text: "Bullion rose, dealers said." },
  ];
  const base = { example_id: "gold-1", asset: "Gold", article_id: "a1", numbered_sentences: formatSentences(sentences), asset_type: "commodity", gold_supporting_sentence_ids: "", notes: "" };

  it("parses numbered sentences back", () => {
    expect(parseSentences(formatSentences(sentences))).toEqual(sentences);
  });

  it("accepts valid labels, counts blanks and skips", () => {
    const { labelled, unlabelled, skipped, problems } = readLabelled([
      { ...base, gold_stance: "Bullish", gold_supporting_sentence_ids: "s1, S2" },
      { ...base, example_id: "gold-2", gold_stance: "" },
      { ...base, example_id: "gold-3", gold_stance: "skip" },
      { ...base, example_id: "gold-4", gold_stance: "unclear" },
    ]);
    expect(problems).toEqual([]);
    expect(labelled.map((l) => [l.gold_stance, l.gold_ids])).toEqual([
      ["bullish", ["S1", "S2"]],
      ["unclear", []],
    ]);
    expect(unlabelled).toBe(1);
    expect(skipped).toBe(1);
  });

  it("reports stance/type mismatches, unknown IDs and missing evidence", () => {
    const { problems } = readLabelled([
      { ...base, gold_stance: "hawkish", gold_supporting_sentence_ids: "S1" },
      { ...base, example_id: "gold-2", gold_stance: "bearish", gold_supporting_sentence_ids: "S9" },
      { ...base, example_id: "gold-3", gold_stance: "neutral" },
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/not allowed for commodity/);
    expect(problems[1]).toMatch(/S9 not in the sentences/);
    expect(problems[2]).toMatch(/needs at least one/);
  });

  it("template starts with the requested columns", () => {
    expect(JUDGE_COLUMNS.slice(0, 7)).toEqual(["example_id", "asset", "article_id", "numbered_sentences", "gold_stance", "gold_supporting_sentence_ids", "notes"]);
  });
});

describe("stratifiedSample", () => {
  const cands: Candidate[] = [];
  for (let i = 0; i < 40; i++) cands.push({ key: `fed-${i}`, asset: "fed", source: i % 2 ? "Fed" : "FXStreet", hard: i % 4 === 0 });
  for (let i = 0; i < 5; i++) cands.push({ key: `gold-${i}`, asset: "gold", source: "FXStreet", hard: i === 0 });
  for (let i = 0; i < 5; i++) cands.push({ key: `btc-${i}`, asset: "btc", source: "CoinDesk", hard: false });

  it("is reproducible for a seed and different for another", () => {
    const a = stratifiedSample(cands, 12, { seed: 1, hardShare: 0.3 }).map((c) => c.key);
    expect(stratifiedSample(cands, 12, { seed: 1, hardShare: 0.3 }).map((c) => c.key)).toEqual(a);
    expect(stratifiedSample(cands, 12, { seed: 2, hardShare: 0.3 }).map((c) => c.key)).not.toEqual(a);
  });

  it("balances assets instead of following the raw skew", () => {
    const picked = stratifiedSample(cands, 12, { seed: 1, hardShare: 0 });
    const per = (a: string) => picked.filter((c) => c.asset === a).length;
    expect([per("fed"), per("gold"), per("btc")]).toEqual([4, 4, 4]);
  });

  it("fills the hard quota, never repeats, and stops when candidates run out", () => {
    const picked = stratifiedSample(cands, 20, { seed: 3, hardShare: 0.3 });
    expect(picked.filter((c) => c.hard).length).toBeGreaterThanOrEqual(6);
    expect(new Set(picked.map((c) => c.key)).size).toBe(picked.length);
    expect(stratifiedSample(cands, 999, { seed: 3, hardShare: 0.3 })).toHaveLength(cands.length);
  });

  it("tops up around existing rows", () => {
    const existing = Array.from({ length: 5 }, () => ({ asset: "fed", hard: false }));
    const picked = stratifiedSample(cands, 5, { seed: 1, hardShare: 0, existing });
    expect(picked.filter((c) => c.asset === "fed")).toHaveLength(0);
  });

  it("seededRandom stays in [0, 1)", () => {
    const r = seededRandom(9);
    for (let i = 0; i < 1000; i++) {
      const x = r();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
});

describe("citation judge schema", () => {
  it("requires exactly one judgement per cited ID", () => {
    const s = citationJudgeSchema(["S1", "S2"]);
    const j = (id: string) => ({ id, verdict: "supports", reason: "x" });
    expect(s.safeParse({ judgements: [j("S2"), j("S1")] }).success).toBe(true);
    expect(s.safeParse({ judgements: [j("S1")] }).success).toBe(false);
    expect(s.safeParse({ judgements: [j("S1"), j("S1")] }).success).toBe(false);
    expect(s.safeParse({ judgements: [j("S1"), j("S3")] }).success).toBe(false);
  });
});
