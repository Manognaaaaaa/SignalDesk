/**
 * Grounding check for AI text: every number the model wrote must come from the evidence.
 * This stops the model from inventing statistics ("98% of clicks were fraud") that a human
 * might act on. Tolerance is 0.5% relative; a ratio like 0.42 may also appear as 42%.
 */

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

/** Extracts numbers from text: "1,240" -> 1240, "42%" -> 42, "$3.50" -> 3.5. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Collects every numeric value (recursively) from an evidence object. */
export function collectEvidenceNumbers(value: unknown, acc: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) acc.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectEvidenceNumbers(v, acc));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectEvidenceNumbers(v, acc));
  return acc;
}

function close(a: number, b: number): boolean {
  if (a === b) return true;
  if (b === 0 || a === 0) return false;
  return Math.abs(a - b) / Math.abs(b) <= 0.005;
}

/** True if `n` matches an allowed number directly, as a percentage of a ratio, or rounded to an integer. */
export function isGrounded(n: number, allowed: number[]): boolean {
  return allowed.some((a) => {
    if (close(n, a)) return true;
    if (a > 0 && a <= 1 && (close(n, a * 100) || Math.round(a * 100) === n || Math.round(a * 1000) / 10 === n)) return true;
    if (Math.round(a) === n && Math.abs(a - n) < 0.5 && Number.isInteger(n) && a > 10) return true;
    return false;
  });
}

/** Returns the numbers in `texts` that are NOT grounded in the evidence (empty = all good). */
export function ungroundedNumbers(texts: string[], evidence: unknown, extraAllowed: number[] = []): number[] {
  const allowed = [...collectEvidenceNumbers(evidence), ...extraAllowed];
  return texts.flatMap(extractNumbers).filter((n) => !isGrounded(n, allowed));
}
