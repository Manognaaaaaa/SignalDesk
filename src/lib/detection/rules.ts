import type { DetectionConfig, RuleCode } from "@/config/detection";
import type { LinkWindowStats, RuleResult, Severity } from "./types";

/**
 * Deterministic fraud rules. Each is a PURE function (stats, config) -> RuleResult, so the same
 * code runs in production (stats from SQL) and in the evaluation harness (stats from memory).
 *
 * A rule SKIPS (fired=false with skipped_reason) when the signal it needs is unknown - e.g. no
 * user-agent data for BOT_SHARE - instead of silently passing or failing. The harness counts
 * skips as "not applicable" so they never inflate or deflate detection rates.
 */

const MIN = 60_000;

/** Ratios are stored with 4 decimals, everything else with 2, so evidence is stable and readable. */
export const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
export const r2 = (x: number) => Math.round(x * 100) / 100;

/** Floors the evaluation time to the rule's window: this bucket is the dedupe key. */
export function windowBucket(asOf: Date, windowMinutes: number): Date {
  const size = windowMinutes * MIN;
  return new Date(Math.floor(asOf.getTime() / size) * size);
}

function result(
  code: RuleCode,
  s: LinkWindowStats,
  windowMinutes: number,
  fired: boolean,
  severity: Severity,
  evidence: Record<string, unknown>,
  skipped_reason?: string,
): RuleResult {
  return {
    fired,
    rule_code: code,
    link_id: s.link_id,
    severity,
    window_start: windowBucket(s.as_of, windowMinutes),
    window_end: s.as_of,
    evidence,
    ...(skipped_reason ? { skipped_reason } : {}),
  };
}

/** IP_BURST: one IP hash hammering one link within 10 minutes (bots, click scripts). */
export function ipBurst(s: LinkWindowStats, cfg: DetectionConfig): RuleResult {
  const c = cfg.IP_BURST;
  const fired = s.last10m.top_ip_clicks >= c.minTopIpClicks;
  return result("IP_BURST", s, c.windowMinutes, fired, c.severity, {
    clicks_from_top_ip: s.last10m.top_ip_clicks,
    total_clicks_in_window: s.last10m.clicks,
    window_minutes: c.windowMinutes,
  });
}

/** BOT_SHARE: too many clicks from known bot user agents. Skips when UA data is mostly unknown. */
export function botShare(s: LinkWindowStats, cfg: DetectionConfig): RuleResult {
  const c = cfg.BOT_SHARE;
  const w = s.last60m;
  if (w.clicks > 0 && w.unknown_bot_clicks * 2 > w.clicks) {
    return result("BOT_SHARE", s, c.windowMinutes, false, c.severity, {}, "bot signal unknown for most clicks");
  }
  const share = w.clicks > 0 ? w.bot_clicks / w.clicks : 0;
  const fired = w.clicks >= c.minClicks && share > c.minBotShare;
  const severity: Severity = share > c.highBotShare ? c.highSeverity : c.severity;
  return result("BOT_SHARE", s, c.windowMinutes, fired, severity, {
    bot_clicks: w.bot_clicks,
    clicks: w.clicks,
    bot_share: r4(share),
  });
}

/** NO_CONVERSIONS: lots of clicks, zero signups, on a link that normally converts. */
export function noConversions(s: LinkWindowStats, cfg: DetectionConfig): RuleResult {
  const c = cfg.NO_CONVERSIONS;
  if (s.baseline7d_signup_rate === null) {
    return result("NO_CONVERSIONS", s, c.windowMinutes, false, c.severity, {}, "not enough baseline history");
  }
  const fired =
    s.last24h.clicks >= c.minClicks24h && s.last24h.signups === 0 && s.baseline7d_signup_rate >= c.minBaselineSignupRate;
  return result("NO_CONVERSIONS", s, c.windowMinutes, fired, c.severity, {
    clicks_24h: s.last24h.clicks,
    signups_24h: s.last24h.signups,
    baseline_signup_rate: r4(s.baseline7d_signup_rate),
  });
}

/** GEO_MISMATCH: most traffic from countries the campaign does not target (click farms, bad targeting). */
export function geoMismatch(s: LinkWindowStats, cfg: DetectionConfig): RuleResult {
  const c = cfg.GEO_MISMATCH;
  const w = s.last60m;
  if (w.clicks > 0 && w.unknown_country_clicks * 2 > w.clicks) {
    return result("GEO_MISMATCH", s, c.windowMinutes, false, c.severity, {}, "country unknown for most clicks");
  }
  const share = w.clicks > 0 ? w.off_target_clicks / w.clicks : 0;
  const fired = w.clicks >= c.minClicks && share > c.minOffTargetShare;
  return result("GEO_MISMATCH", s, c.windowMinutes, fired, c.severity, {
    off_target_clicks: w.off_target_clicks,
    clicks: w.clicks,
    off_target_share: r4(share),
    top_off_target_countries: w.top_off_target_countries,
  });
}

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/**
 * CLICK_SPIKE: last-60-minute clicks far above the link's hourly history (z-score).
 * If the history has zero variance we fall back to a MAD-based robust z; if MAD is also zero
 * the baseline carries no spread information, so we skip rather than divide by zero.
 */
export function clickSpike(s: LinkWindowStats, cfg: DetectionConfig): RuleResult {
  const c = cfg.CLICK_SPIKE;
  const h = s.hourly_history;
  if (h.length < c.minHistoryPoints) {
    return result("CLICK_SPIKE", s, c.windowMinutes, false, c.severity, {}, "not enough hourly history");
  }
  const mean = h.reduce((a, b) => a + b, 0) / h.length;
  const std = Math.sqrt(h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length);
  let z: number;
  if (std > 0) {
    z = (s.current_hour_clicks - mean) / std;
  } else {
    const med = median(h);
    const mad = median(h.map((x) => Math.abs(x - med)));
    if (mad === 0) {
      return result("CLICK_SPIKE", s, c.windowMinutes, false, c.severity, {}, "flat history (zero spread)");
    }
    z = (0.6745 * (s.current_hour_clicks - med)) / mad;
  }
  const fired = z >= c.minZScore && s.current_hour_clicks >= c.minCurrentClicks;
  return result("CLICK_SPIKE", s, c.windowMinutes, fired, c.severity, {
    current_hour_clicks: s.current_hour_clicks,
    baseline_mean: r2(mean),
    baseline_std: r2(std),
    z_score: r2(z),
    history_points: h.length,
  });
}

export const RULES = [ipBurst, botShare, noConversions, geoMismatch, clickSpike] as const;
