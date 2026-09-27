/**
 * Classification and citation metrics for the Judge eval. Pure functions, unit-tested.
 * Predictions that are not a stance (a validation failure, or a call that never completed)
 * are kept as their own labels, so they count as wrong instead of silently disappearing.
 */

export type ClassStats = { support: number; predicted: number; tp: number; precision: number | null; recall: number | null; f1: number | null };

export type ClassificationReport = {
  n: number;
  correct: number;
  accuracy: number | null;
  /** Mean F1 over the gold classes that have support > 0 (classes absent from the gold set are excluded). */
  macro_f1: number | null;
  macro_f1_classes: string[];
  per_class: Record<string, ClassStats>;
  /** matrix[gold][predicted] = count. Rows = gold labels, columns = gold labels + any extra predicted labels. */
  labels_gold: string[];
  labels_pred: string[];
  matrix: Record<string, Record<string, number>>;
};

const div = (a: number, b: number) => (b === 0 ? null : a / b);

export function classificationReport(pairs: { gold: string; pred: string }[], classOrder: readonly string[]): ClassificationReport {
  const golds = classOrder.filter((c) => pairs.some((p) => p.gold === c));
  const extraGold = [...new Set(pairs.map((p) => p.gold))].filter((g) => !classOrder.includes(g));
  const labelsGold = [...golds, ...extraGold];
  const predSeen = new Set(pairs.map((p) => p.pred));
  const labelsPred = [...classOrder.filter((c) => golds.includes(c) || predSeen.has(c)), ...[...predSeen].filter((p) => !classOrder.includes(p)).sort()];

  const matrix: Record<string, Record<string, number>> = {};
  for (const g of labelsGold) matrix[g] = Object.fromEntries(labelsPred.map((p) => [p, 0]));
  for (const { gold, pred } of pairs) matrix[gold]![pred]! += 1;

  const per_class: Record<string, ClassStats> = {};
  for (const c of classOrder) {
    const support = pairs.filter((p) => p.gold === c).length;
    const predicted = pairs.filter((p) => p.pred === c).length;
    if (!support && !predicted) continue;
    const tp = pairs.filter((p) => p.gold === c && p.pred === c).length;
    const precision = div(tp, predicted);
    const recall = div(tp, support);
    const f1 = precision === null || recall === null ? (support ? 0 : null) : precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    per_class[c] = { support, predicted, tp, precision, recall, f1 };
  }
  const f1s = golds.map((c) => per_class[c]!.f1 ?? 0);
  const correct = pairs.filter((p) => p.gold === p.pred).length;
  return {
    n: pairs.length,
    correct,
    accuracy: div(correct, pairs.length),
    macro_f1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
    macro_f1_classes: golds,
    per_class,
    labels_gold: labelsGold,
    labels_pred: labelsPred,
    matrix,
  };
}

/** Micro-averaged overlap between predicted and gold supporting sentence IDs. */
export function citationOverlap(items: { predicted: string[]; gold: string[] }[]) {
  let inter = 0;
  let pred = 0;
  let gold = 0;
  for (const it of items) {
    const g = new Set(it.gold);
    const p = new Set(it.predicted);
    pred += p.size;
    gold += g.size;
    for (const id of p) if (g.has(id)) inter++;
  }
  return { n: items.length, precision: div(inter, pred), recall: div(inter, gold) };
}

export const fmtPct = (x: number | null | undefined, digits = 1) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`);
