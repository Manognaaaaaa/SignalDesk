import type { MoodPoint, PricePoint, TimelineSignal } from "@/lib/ui-types";

/**
 * Merges daily closes, daily mood and scored signals into one row per UTC calendar day for the
 * mood-vs-price chart. Pure, so it is unit-tested. Markets are closed on some days (weekends for
 * FX/indices): those rows keep close = null and the line is drawn across the gap; days without
 * news have no dot; days without a mood have no bar.
 */

export type ChartRow = {
  day: string;
  close: number | null;
  mood: number | null;
  confidence: MoodPoint["confidence"];
  /** Scored signals that day, and their net direction (+1 up/hawkish, -1 down/dovish, 0 neutral). */
  signals: number;
  net: number;
};

const DIRECTION: Record<string, number> = { bullish: 1, hawkish: 1, bearish: -1, dovish: -1, neutral: 0 };

export function lastNDays(n: number, today: Date): string[] {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export function buildChartRows(prices: PricePoint[], mood: MoodPoint[], signals: TimelineSignal[], days: number, today: Date = new Date()): ChartRow[] {
  const close = new Map(prices.map((p) => [p.day, p.close]));
  const moodBy = new Map(mood.map((m) => [m.day, m]));
  const sig = new Map<string, { n: number; sum: number }>();
  for (const s of signals) {
    const e = sig.get(s.day) ?? { n: 0, sum: 0 };
    e.n++;
    e.sum += DIRECTION[s.stance] ?? 0;
    sig.set(s.day, e);
  }
  return lastNDays(days, today).map((day) => {
    const s = sig.get(day);
    const m = moodBy.get(day);
    return { day, close: close.get(day) ?? null, mood: m?.score ?? null, confidence: m?.confidence ?? null, signals: s?.n ?? 0, net: s ? Math.sign(s.sum) : 0 };
  });
}

/** Percentage change between the first and last known close in the rows (null if < 2 closes). */
export function priceChange(rows: ChartRow[]): number | null {
  const closes = rows.map((r) => r.close).filter((c): c is number => c !== null);
  if (closes.length < 2) return null;
  return (closes.at(-1)! / closes[0]! - 1) * 100;
}
