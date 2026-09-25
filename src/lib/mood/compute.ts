import { MOOD_CONFIG, STANCE_VALUE } from "@/config/mood";

/**
 * Deterministic daily mood per asset (formula documented in README and /how-it-works):
 *  1. value: bullish/hawkish +1, bearish/dovish -1, neutral 0; unclear and failed are excluded.
 *  2. one vote per (story, source): repeated coverage by one outlet counts once (strongest, then newest signal).
 *  3. weight = strength/3 x recency (half-life 24 h) x 1/(votes from the same source that day).
 *  4. score = weighted mean, clamped to [-1, 1]; agreement = share of votes whose sign matches the score's sign.
 *  5. confidence: high if >= 3 sources and agreement >= 0.7; medium if >= 2 sources; else low.
 */

export type MoodSignal = {
  asset_id: string;
  article_id: string;
  source_id: string;
  story_id: string | null;
  stance: string;
  strength: number;
  status: string;
  /** Article time (published_at, or fetched_at if missing). */
  at: Date;
};

export type MoodRow = {
  asset_id: string;
  day: string; // YYYY-MM-DD (UTC)
  score: number;
  confidence: "low" | "medium" | "high";
  article_count: number;
  source_count: number;
  agreement: number;
};

const DAY = 86_400_000;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const sign = (x: number) => (x > 1e-9 ? 1 : x < -1e-9 ? -1 : 0);

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Recency weight: 1 at the reference time, halving every half-life. Future times count as 1. */
export function recencyWeight(at: Date, reference: number, halfLifeHours = MOOD_CONFIG.halfLifeHours): number {
  const ageH = Math.max(0, reference - at.getTime()) / 3_600_000;
  return Math.pow(0.5, ageH / halfLifeHours);
}

export function confidenceFor(sources: number, agreement: number): MoodRow["confidence"] {
  const c = MOOD_CONFIG.confidence;
  if (sources >= c.highMinSources && agreement >= c.highMinAgreement) return "high";
  if (sources >= c.mediumMinSources) return "medium";
  return "low";
}

/** Computes one row per (asset, UTC day) that has at least one usable vote. */
export function computeMood(signals: MoodSignal[], now: Date = new Date()): MoodRow[] {
  // 1. usable signals with a direction value
  const usable = signals.filter((s) => s.status === "ok" && STANCE_VALUE[s.stance] !== undefined);

  // 2. one vote per (asset, day, source, story)
  const votes = new Map<string, MoodSignal>();
  for (const s of usable) {
    const key = `${s.asset_id}|${utcDay(s.at)}|${s.source_id}|${s.story_id ?? `article:${s.article_id}`}`;
    const prev = votes.get(key);
    if (!prev || s.strength > prev.strength || (s.strength === prev.strength && s.at > prev.at)) votes.set(key, s);
  }

  // group votes by asset/day
  const groups = new Map<string, MoodSignal[]>();
  for (const v of votes.values()) {
    const k = `${v.asset_id}|${utcDay(v.at)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(v);
  }

  const rows: MoodRow[] = [];
  for (const [k, vs] of groups) {
    const [asset_id, day] = k.split("|") as [string, string];
    const endOfDay = Date.parse(`${day}T00:00:00Z`) + DAY;
    const reference = Math.min(now.getTime(), endOfDay); // today: relative to now; past days: to their end
    const perSource = new Map<string, number>();
    for (const v of vs) perSource.set(v.source_id, (perSource.get(v.source_id) ?? 0) + 1);

    let wSum = 0;
    let wvSum = 0;
    for (const v of vs) {
      const w = (v.strength / 3) * recencyWeight(v.at, reference) * (1 / perSource.get(v.source_id)!);
      wSum += w;
      wvSum += w * STANCE_VALUE[v.stance]!;
    }
    const score = wSum > 0 ? Math.max(-1, Math.min(1, wvSum / wSum)) : 0;
    const agree = vs.filter((v) => sign(STANCE_VALUE[v.stance]!) === sign(score)).length / vs.length;
    const sources = perSource.size;
    rows.push({
      asset_id,
      day,
      score: r3(score),
      confidence: confidenceFor(sources, agree),
      article_count: new Set(vs.map((v) => v.article_id)).size,
      source_count: sources,
      agreement: r3(agree),
    });
  }
  return rows.sort((a, b) => (a.asset_id + a.day).localeCompare(b.asset_id + b.day));
}
