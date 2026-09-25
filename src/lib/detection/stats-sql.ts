import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { baselineRate, denseHistory, topCountries } from "./stats-memory";
import type { LinkWindowStats } from "./types";

/**
 * Production stats source: calls the set-based SQL function get_link_window_stats and maps its
 * rows into LinkWindowStats using the SAME helper functions as the in-memory path
 * (baselineRate, denseHistory, topCountries), so both sources agree exactly.
 */

const int = z.coerce.number().int();
export const statsRowSchema = z.object({
  link_id: z.string(),
  target_countries: z.array(z.string()),
  l10_clicks: int,
  l10_top_ip_clicks: int,
  l60_clicks: int,
  l60_bot_clicks: int,
  l60_unknown_bot_clicks: int,
  l60_off_target_clicks: int,
  l60_unknown_country_clicks: int,
  l60_top_off_target: z.array(z.object({ country_code: z.string(), clicks: int })),
  l24_clicks: int,
  l24_signups: int,
  base_clicks: int,
  base_signups: int,
  history_first_bucket: z.coerce.number().int().nullable(),
  history_last_bucket: z.coerce.number().int(),
  history: z.record(z.string(), int),
});
export type StatsRow = z.infer<typeof statsRowSchema>;

/** Maps one validated SQL row to LinkWindowStats. */
export function mapStatsRow(row: StatsRow, asOf: Date): LinkWindowStats {
  const counts = new Map<number, number>(Object.entries(row.history).map(([k, v]) => [Number(k), v]));
  const off = new Map(row.l60_top_off_target.map((c) => [c.country_code.trim().toUpperCase(), c.clicks]));
  return {
    link_id: row.link_id,
    as_of: asOf,
    target_countries: row.target_countries.map((c) => c.trim().toUpperCase()),
    last10m: { clicks: row.l10_clicks, top_ip_clicks: row.l10_top_ip_clicks },
    last60m: {
      clicks: row.l60_clicks,
      bot_clicks: row.l60_bot_clicks,
      unknown_bot_clicks: row.l60_unknown_bot_clicks,
      off_target_clicks: row.l60_off_target_clicks,
      unknown_country_clicks: row.l60_unknown_country_clicks,
      top_off_target_countries: topCountries(off),
    },
    last24h: { clicks: row.l24_clicks, signups: row.l24_signups },
    baseline7d_signup_rate: baselineRate(row.base_clicks, row.base_signups),
    current_hour_clicks: row.l60_clicks,
    hourly_history: denseHistory(counts, row.history_first_bucket, row.history_last_bucket),
  };
}

/** Fetches stats for every active, non-loadtest link as of `asOf` (service-role client required). */
export async function computeStatsFromDb(db: SupabaseClient, asOf: Date): Promise<LinkWindowStats[]> {
  const { data, error } = await db.rpc("get_link_window_stats", { p_as_of: asOf.toISOString() });
  if (error) throw new Error(`get_link_window_stats failed: ${error.code ?? "unknown"}`);
  const rows = z.array(statsRowSchema).parse(data ?? []);
  return rows.map((r) => mapStatsRow(r, asOf));
}
