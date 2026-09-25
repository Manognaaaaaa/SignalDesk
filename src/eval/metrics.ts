/**
 * Small, dependency-free statistics used by the evaluation harness. Each function is tested
 * against known textbook values (tests/eval-metrics.test.ts).
 */

export type Interval = { rate: number; low: number; high: number };

/**
 * Wilson score interval for a binomial proportion (95% by default). Unlike the naive
 * p ± 1.96·sqrt(p(1-p)/n) interval it behaves well at 0%, 100% and small n - exactly the
 * situation of "48/50 attacks detected".
 */
export function wilson(successes: number, n: number, z = 1.959964): Interval {
  if (n <= 0) return { rate: 0, low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // At 0% / 100% the bound is exactly 0 / 1 (avoid 0.9999999999999999 from rounding).
  return { rate: p, low: successes === 0 ? 0 : Math.max(0, centre - half), high: successes === n ? 1 : Math.min(1, centre + half) };
}

/** Error function (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7). */
export function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** Standard normal CDF. */
export const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

export type ZTest = { p1: number; p2: number; z: number; p_value: number };

/**
 * Two-proportion z-test (pooled, two-sided): is the rate x1/n1 different from x2/n2?
 * Used on the replay to test "flagged traffic converts less than unflagged traffic".
 */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): ZTest {
  const p1 = n1 > 0 ? x1 / n1 : 0;
  const p2 = n2 > 0 ? x2 / n2 : 0;
  if (n1 === 0 || n2 === 0) return { p1, p2, z: 0, p_value: 1 };
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return { p1, p2, z: 0, p_value: 1 };
  const z = (p1 - p2) / se;
  return { p1, p2, z, p_value: Math.min(1, 2 * (1 - normCdf(Math.abs(z)))) };
}

/** Percentile with linear interpolation between closest ranks (p in [0, 100]); null for empty input. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const a = [...values].sort((x, y) => x - y);
  const rank = (p / 100) * (a.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return a[lo]! + (a[hi]! - a[lo]!) * (rank - lo);
}

export const median = (values: number[]) => percentile(values, 50);

export const round = (x: number, dp = 4) => Math.round(x * 10 ** dp) / 10 ** dp;
