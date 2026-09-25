import { DETECTION_CONFIG } from "@/config/detection";
import type { CountryCount, DetectionEvent, DetectionLink, LinkWindowStats } from "./types";

/**
 * In-memory implementation of LinkWindowStats, used by the evaluation harness.
 * Its window semantics are identical to the SQL function get_link_window_stats (see
 * 002_functions.sql); tests/stats-parity.test.ts proves both produce identical stats.
 *
 *   last10m / last60m / last24h : clicks with  as_of - window < at <= as_of
 *   baseline                    : clicks with  as_of - 8d < at <= as_of - 24h
 *   hourly_history              : UTC clock-hour buckets [H-168, H-1], H = hour bucket of as_of,
 *                                 starting at the first bucket that has any click (zeros filled)
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const HISTORY_HOURS = 168;

/** Signup rate over the baseline window, or null when volume is too low to trust it. Shared with stats-sql. */
export function baselineRate(clicks: number, signups: number): number | null {
  if (clicks < DETECTION_CONFIG.NO_CONVERSIONS.baselineMinClicks) return null;
  return signups / clicks;
}

/** Expands sparse hour buckets into a dense oldest-first array. Shared with stats-sql. */
export function denseHistory(counts: Map<number, number>, firstBucket: number | null, lastBucket: number): number[] {
  if (firstBucket === null || firstBucket > lastBucket) return [];
  const out: number[] = [];
  for (let b = firstBucket; b <= lastBucket; b++) out.push(counts.get(b) ?? 0);
  return out;
}

/** Sorts off-target country counts by clicks desc, then code asc, and keeps the top 3. Shared with stats-sql. */
export function topCountries(counts: Map<string, number>): CountryCount[] {
  return [...counts.entries()]
    .map(([country_code, clicks]) => ({ country_code, clicks }))
    .sort((a, b) => b.clicks - a.clicks || (a.country_code < b.country_code ? -1 : a.country_code > b.country_code ? 1 : 0))
    .slice(0, 3);
}

/** Number of elements in the sorted array that are <= x (binary search). */
function countLE(t: Float64Array, x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Per-link index: events sorted once, plus prefix sums so any window count is O(log n). */
type LinkIndex = {
  link: DetectionLink;
  t: Float64Array;
  ip: string[];
  country: (string | null)[];
  offTarget: Uint8Array;
  pBot: Int32Array;
  pUnknownBot: Int32Array;
  pOff: Int32Array;
  pUnknownCountry: Int32Array;
  pSignup: Int32Array;
  hourCounts: Map<number, number>;
  historyCache: Map<number, number[]>;
};

function buildIndex(link: DetectionLink, events: DetectionEvent[]): LinkIndex {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const n = sorted.length;
  const targets = new Set(link.target_countries.map((c) => c.toUpperCase()));
  const idx: LinkIndex = {
    link,
    t: new Float64Array(n),
    ip: new Array(n),
    country: new Array(n),
    offTarget: new Uint8Array(n),
    pBot: new Int32Array(n + 1),
    pUnknownBot: new Int32Array(n + 1),
    pOff: new Int32Array(n + 1),
    pUnknownCountry: new Int32Array(n + 1),
    pSignup: new Int32Array(n + 1),
    hourCounts: new Map(),
    historyCache: new Map(),
  };
  for (let i = 0; i < n; i++) {
    const e = sorted[i]!;
    const ms = e.at.getTime();
    const cc = e.country_code ? e.country_code.toUpperCase() : null;
    const off = cc !== null && !targets.has(cc);
    idx.t[i] = ms;
    idx.ip[i] = e.ip_hash;
    idx.country[i] = cc;
    idx.offTarget[i] = off ? 1 : 0;
    idx.pBot[i + 1] = idx.pBot[i]! + (e.is_bot === true ? 1 : 0);
    idx.pUnknownBot[i + 1] = idx.pUnknownBot[i]! + (e.is_bot === null ? 1 : 0);
    idx.pOff[i + 1] = idx.pOff[i]! + (off ? 1 : 0);
    idx.pUnknownCountry[i + 1] = idx.pUnknownCountry[i]! + (cc === null ? 1 : 0);
    idx.pSignup[i + 1] = idx.pSignup[i]! + (e.converted_signup ? 1 : 0);
    const bucket = Math.floor(ms / HOUR);
    idx.hourCounts.set(bucket, (idx.hourCounts.get(bucket) ?? 0) + 1);
  }
  return idx;
}

/**
 * Pre-indexes a whole event timeline so stats can be computed at thousands of checkpoints
 * cheaply (the harness simulates the 5-minute cron across days of traffic).
 * Sorting happens once; each checkpoint is binary searches + prefix-sum lookups, and the
 * hourly history is cached per clock hour because it only changes when the hour changes.
 */
export class StatsTimeline {
  private readonly indexes: LinkIndex[];

  constructor(events: DetectionEvent[], links: DetectionLink[]) {
    const byLink = new Map<string, DetectionEvent[]>();
    for (const l of links) byLink.set(l.id, []);
    for (const e of events) byLink.get(e.link_id)?.push(e); // events for unknown links are ignored
    this.indexes = links.map((l) => buildIndex(l, byLink.get(l.id)!));
  }

  /** Stats for every link as of `asOf` (events after asOf are invisible, like in production). */
  statsAt(asOf: Date): LinkWindowStats[] {
    return this.indexes.map((ix) => this.statsFor(ix, asOf));
  }

  private statsFor(ix: LinkIndex, asOf: Date): LinkWindowStats {
    const now = asOf.getTime();
    const end = countLE(ix.t, now);
    const s10 = countLE(ix.t, now - 10 * MIN);
    const s60 = countLE(ix.t, now - HOUR);
    const s24 = countLE(ix.t, now - DAY);
    const sBase = countLE(ix.t, now - 8 * DAY);

    // Top single IP in the last 10 minutes (small window: direct count).
    const ipCounts = new Map<string, number>();
    let topIp = 0;
    for (let i = s10; i < end; i++) {
      const c = (ipCounts.get(ix.ip[i]!) ?? 0) + 1;
      ipCounts.set(ix.ip[i]!, c);
      if (c > topIp) topIp = c;
    }

    // Top off-target countries in the last 60 minutes.
    const offCounts = new Map<string, number>();
    for (let i = s60; i < end; i++) {
      if (ix.offTarget[i]) offCounts.set(ix.country[i]!, (offCounts.get(ix.country[i]!) ?? 0) + 1);
    }

    const l60 = end - s60;
    return {
      link_id: ix.link.id,
      as_of: asOf,
      target_countries: [...ix.link.target_countries],
      last10m: { clicks: end - s10, top_ip_clicks: topIp },
      last60m: {
        clicks: l60,
        bot_clicks: ix.pBot[end]! - ix.pBot[s60]!,
        unknown_bot_clicks: ix.pUnknownBot[end]! - ix.pUnknownBot[s60]!,
        off_target_clicks: ix.pOff[end]! - ix.pOff[s60]!,
        unknown_country_clicks: ix.pUnknownCountry[end]! - ix.pUnknownCountry[s60]!,
        top_off_target_countries: topCountries(offCounts),
      },
      last24h: { clicks: end - s24, signups: ix.pSignup[end]! - ix.pSignup[s24]! },
      baseline7d_signup_rate: baselineRate(s24 - sBase, ix.pSignup[s24]! - ix.pSignup[sBase]!),
      current_hour_clicks: l60,
      hourly_history: this.historyFor(ix, Math.floor(now / HOUR)),
    };
  }

  private historyFor(ix: LinkIndex, currentBucket: number): number[] {
    const cached = ix.historyCache.get(currentBucket);
    if (cached) return cached;
    const from = currentBucket - HISTORY_HOURS;
    const last = currentBucket - 1;
    let first: number | null = null;
    for (let b = from; b <= last; b++) {
      if (ix.hourCounts.has(b)) {
        first = b;
        break;
      }
    }
    const hist = denseHistory(ix.hourCounts, first, last);
    ix.historyCache.set(currentBucket, hist);
    return hist;
  }
}

/** One-shot convenience wrapper: stats for all links at a single point in time. */
export function computeStatsInMemory(events: DetectionEvent[], links: DetectionLink[], asOf: Date): LinkWindowStats[] {
  return new StatsTimeline(events, links).statsAt(asOf);
}
