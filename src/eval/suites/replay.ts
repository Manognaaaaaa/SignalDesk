import { existsSync } from "node:fs";
import { DETECTION_CONFIG, RULE_CODES } from "@/config/detection";
import type { EvalAlert } from "../matching";
import { round, twoProportionZ } from "../metrics";
import { runDetectionTimeline } from "../runner";
import { loadTalkingData, type ReplayEvent } from "../talkingdata-loader";
import type { ReplaySummary } from "../types";

/**
 * SUITE 5 - replay of real third-party traffic (TalkingData AdTracking, Kaggle).
 * This data was not created by us and the thresholds were not tuned on it.
 *
 * LIMITATION: the dataset has NO fraud labels, only conversions (is_attributed). So we use proxy
 * validation: if the rules flag low-quality traffic, flagged clicks should convert much less
 * than unflagged clicks. We report the ratio and a two-proportion z-test. A low ratio is
 * consistent with - but does not prove - that the flagged traffic is fraudulent.
 */

export const DEFAULT_REPLAY_PATH = "data/talkingdata/train_sample.csv";

export const REPLAY_HELP = [
  `TalkingData sample not found at ${DEFAULT_REPLAY_PATH} - skipping the replay suite (not a failure).`,
  "To enable it: accept the rules of the Kaggle competition 'TalkingData AdTracking Fraud Detection Challenge',",
  `download train_sample.csv and place it at ${DEFAULT_REPLAY_PATH}. The file is gitignored and must never be committed.`,
].join("\n");

/** Upper bound (last index, exclusive) of events with time <= t in a sorted time array. */
function upper(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type ReplayChannelRow = { channel: string; clicks: number; unique_ips: number; clicks_per_ip: number; attribution_rate: number; alerts: number; flagged_clicks: number };

/** Proxy metrics from events + alerts (pure; unit-testable without the CSV). */
export function replayProxyMetrics(events: ReplayEvent[], alerts: EvalAlert[]) {
  const byLink = new Map<string, ReplayEvent[]>();
  for (const e of events) (byLink.get(e.link_id) ?? byLink.set(e.link_id, []).get(e.link_id)!).push(e);
  const flagged = new Set<ReplayEvent>();
  const burstIps = new Set<string>();
  const alertsPerLink = new Map<string, number>();

  for (const a of alerts) {
    alertsPerLink.set(a.link_id, (alertsPerLink.get(a.link_id) ?? 0) + 1);
    const evs = byLink.get(a.link_id) ?? [];
    const times = evs.map((e) => e.at.getTime());
    const t = a.at.getTime();
    const lookback = DETECTION_CONFIG[a.rule_code].windowMinutes * 60_000;
    const from = upper(times, t - lookback);
    const to = upper(times, t);
    const counts = new Map<string, number>();
    for (let i = from; i < to; i++) {
      flagged.add(evs[i]!);
      if (a.rule_code === "IP_BURST") counts.set(evs[i]!.ip_hash, (counts.get(evs[i]!.ip_hash) ?? 0) + 1);
    }
    if (a.rule_code === "IP_BURST") {
      let best = "";
      let n = 0;
      for (const [ip, c] of counts) if (c > n) [best, n] = [ip, c];
      if (best) burstIps.add(best);
    }
  }

  const f = { clicks: 0, attributed: 0 };
  const u = { clicks: 0, attributed: 0 };
  const b = { clicks: 0, attributed: 0 };
  const o = { clicks: 0, attributed: 0 };
  for (const e of events) {
    const bucket = flagged.has(e) ? f : u;
    bucket.clicks++;
    if (e.converted_signup) bucket.attributed++;
    const ipBucket = burstIps.has(e.ip_hash) ? b : o;
    ipBucket.clicks++;
    if (e.converted_signup) ipBucket.attributed++;
  }
  const rate = (x: { clicks: number; attributed: number }) => (x.clicks ? x.attributed / x.clicks : 0);
  const z = twoProportionZ(f.attributed, f.clicks, u.attributed, u.clicks);
  const zb = twoProportionZ(b.attributed, b.clicks, o.attributed, o.clicks);

  const channels: ReplayChannelRow[] = [];
  for (const [link, evs] of byLink) {
    const ips = new Set(evs.map((e) => e.ip_hash));
    const attributed = evs.filter((e) => e.converted_signup).length;
    const fc = evs.filter((e) => flagged.has(e)).length;
    if (fc === 0) continue;
    channels.push({
      channel: evs[0]!.channel,
      clicks: evs.length,
      unique_ips: ips.size,
      clicks_per_ip: round(evs.length / ips.size, 2),
      attribution_rate: round(attributed / evs.length, 5),
      alerts: alertsPerLink.get(link) ?? 0,
      flagged_clicks: fc,
    });
  }
  channels.sort((x, y) => y.flagged_clicks - x.flagged_clicks);

  return {
    coverage_share: events.length ? round(f.clicks / events.length, 5) : 0,
    flagged: { ...f, rate: round(rate(f), 6) },
    unflagged: { ...u, rate: round(rate(u), 6) },
    attribution_ratio: rate(u) > 0 && f.clicks > 0 ? round(rate(f) / rate(u), 4) : null,
    z_test: { z: round(z.z, 3), p_value: z.p_value < 1e-12 ? 0 : Number(z.p_value.toPrecision(3)) },
    burst_ips: {
      ips: burstIps.size,
      clicks: b.clicks,
      rate: round(rate(b), 6),
      other_rate: round(rate(o), 6),
      ratio: rate(o) > 0 && b.clicks > 0 ? round(rate(b) / rate(o), 4) : null,
      p_value: zb.p_value < 1e-12 ? 0 : Number(zb.p_value.toPrecision(3)),
    },
    top_channels: channels.slice(0, 10),
  };
}

export async function runReplay(opts: { path?: string; salt: string; maxRows: number; onProgress?: (msg: string) => void }): Promise<{ summary: ReplaySummary; details: Record<string, unknown> }> {
  const path = opts.path ?? DEFAULT_REPLAY_PATH;
  if (!existsSync(path)) return { summary: { skipped: true, message: REPLAY_HELP }, details: {} };

  const load = await loadTalkingData(path, { salt: opts.salt, maxRows: opts.maxRows });
  opts.onProgress?.(`replay: loaded ${load.rows_valid} valid rows (${load.rows_malformed} malformed) across ${load.links.length} channels`);
  if (load.events.length === 0) return { summary: { skipped: true, message: "No valid rows in the replay file." }, details: {} };

  // In-memory run keeps the ORIGINAL timestamps; cron is simulated every 5 minutes across the span.
  const from = load.events[0]!.at;
  const to = load.events[load.events.length - 1]!.at;
  const run = runDetectionTimeline(load.events, load.links, from, to);
  const byRule: Record<string, number> = Object.fromEntries(RULE_CODES.map((r) => [r, 0]));
  for (const a of run.alerts) byRule[a.rule_code] = (byRule[a.rule_code] ?? 0) + 1;
  // A rule is "not applicable" when it skipped at (nearly) every checkpoint for lack of signal.
  const linkChecks = run.checkpoints * load.links.length;
  const notApplicable = RULE_CODES.filter((r) => (run.skippedByRule[r] ?? 0) >= 0.99 * linkChecks && linkChecks > 0);
  const proxy = replayProxyMetrics(load.events, run.alerts);
  opts.onProgress?.(`replay: ${run.alerts.length} alerts, flagged/unflagged attribution ratio ${proxy.attribution_ratio ?? "n/a"}`);

  return {
    summary: {
      skipped: false,
      rows_read: load.rows_read,
      rows_valid: load.rows_valid,
      rows_malformed: load.rows_malformed,
      links: load.links.length,
      unique_ips: new Set(load.events.map((e) => e.ip_hash)).size,
      time_span_hours: round((to.getTime() - from.getTime()) / 3_600_000, 1),
      alerts_by_rule: byRule,
      not_applicable_rules: notApplicable,
      coverage_share: proxy.coverage_share,
      flagged: proxy.flagged,
      unflagged: proxy.unflagged,
      attribution_ratio: proxy.attribution_ratio,
      z_test: proxy.z_test,
      burst_ips: proxy.burst_ips,
    },
    details: { top_flagged_channels: proxy.top_channels, skipped_by_rule: run.skippedByRule, checkpoints: run.checkpoints },
  };
}
