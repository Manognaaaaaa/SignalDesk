import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRICE_SYMBOLS } from "@/config/price-symbols";
import { candleDay, fetchDailyCandles, type DerivDeps } from "@/lib/prices/deriv";

/**
 * Step 7: daily prices for the mood-vs-price chart. Deriv's public API allows about one
 * ticks_history request every 3 s, so a run refreshes only the few most out-of-date symbols
 * (~7 s); all 16 are refreshed within 8 two-hourly runs, which is plenty for daily
 * candles. History is loaded once with `npm run prices -- --backfill`.
 */

export const SYMBOLS_PER_RUN = 2;
/** Candles requested for a symbol that already has history (covers weekends + a missed day). */
const TOP_UP_CANDLES = 7;

export type PriceStats = { symbols: string[]; rows_upserted: number; errors: Record<string, string> };
type Tracked = { asset_id: string; slug: string; symbol: string; last_day: string | null };

/** Oldest-first by last stored day (never-fetched first), skipping symbols already current. */
export function pickStale(tracked: Tracked[], today: string, n: number): Tracked[] {
  return tracked
    .filter((t) => t.last_day === null || t.last_day < today)
    .sort((a, b) => (a.last_day ?? "").localeCompare(b.last_day ?? "") || a.slug.localeCompare(b.slug))
    .slice(0, n);
}

/** Assets with a Deriv symbol, with the last day already stored for each. */
async function loadTracked(db: SupabaseClient): Promise<Tracked[]> {
  const slugs = Object.keys(PRICE_SYMBOLS);
  const { data: assets, error } = await db.from("assets").select("id, slug").in("slug", slugs);
  if (error) throw new Error(`assets read failed: ${error.code ?? "unknown"}`);
  const out: Tracked[] = [];
  for (const a of assets ?? []) {
    const { data: last } = await db.from("daily_prices").select("day").eq("asset_id", a.id).order("day", { ascending: false }).limit(1).maybeSingle();
    out.push({ asset_id: a.id as string, slug: a.slug as string, symbol: PRICE_SYMBOLS[a.slug as string]!.symbol, last_day: (last?.day as string | undefined) ?? null });
  }
  return out;
}

export async function runPriceStep(db: SupabaseClient, opts: { maxSymbols?: number; candles?: number; slugs?: string[]; deps?: DerivDeps; now?: Date } = {}): Promise<PriceStats> {
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const tracked = (await loadTracked(db)).filter((t) => !opts.slugs || opts.slugs.includes(t.slug));
  const chosen = opts.slugs ? tracked : pickStale(tracked, today, opts.maxSymbols ?? SYMBOLS_PER_RUN);
  const stats: PriceStats = { symbols: chosen.map((c) => c.symbol), rows_upserted: 0, errors: {} };
  if (chosen.length === 0) return stats;

  const results = await fetchDailyCandles(
    chosen.map((c) => c.symbol),
    opts.candles ?? TOP_UP_CANDLES,
    opts.deps,
  );
  for (const r of results) {
    const t = chosen.find((c) => c.symbol === r.symbol)!;
    if (!r.ok) {
      stats.errors[r.symbol] = r.error;
      continue;
    }
    const rows = r.candles.map((c) => ({ asset_id: t.asset_id, day: candleDay(c), open: c.open, high: c.high, low: c.low, close: c.close, source: "deriv", symbol: r.symbol, fetched_at: new Date().toISOString() }));
    const { error } = await db.from("daily_prices").upsert(rows, { onConflict: "asset_id,day" });
    if (error) stats.errors[r.symbol] = `save_${error.code ?? "failed"}`;
    else stats.rows_upserted += rows.length;
  }
  return stats;
}
