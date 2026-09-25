import { DETECTION_CONFIG } from "@/config/detection";
import { clickSpike } from "@/lib/detection/rules";
import { HELD_OUT_ATTACKS } from "@/lib/simulate/generator";
import { matchAttack } from "../matching";
import { median, round } from "../metrics";
import { runDetectionTimeline } from "../runner";
import { buildTrial, seedFor } from "../trial";
import type { HeldOutSummary } from "../types";
import { summariseKind } from "./randomised";

/**
 * SUITE 4 - held-out attacks the rules were NOT designed for (slow_drip, distributed_bots).
 * Thresholds must never be tuned on these. A low detection rate is expected and reported as is.
 * For every trial we record how close each rule got during the attack (the "closest approach"),
 * and the auto-generated note names the signal that never crossed its threshold.
 */

type Approach = { top_ip_10m: number; bot_share_60m: number; off_target_share_60m: number; z: number; clicks_24h_zero_signups: number };

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Plain-English note from the median closest approach of each rule across trials. */
export function missingSignalNote(kind: string, detectionRate: number, a: Approach, caughtBy: Record<string, number> = {}): string {
  const c = DETECTION_CONFIG;
  const parts: string[] = [];
  if (a.top_ip_10m < c.IP_BURST.minTopIpClicks)
    parts.push(`no single 10-minute window exceeded the IP_BURST threshold (busiest IP: median ${a.top_ip_10m} clicks vs ${c.IP_BURST.minTopIpClicks})`);
  if (a.bot_share_60m <= c.BOT_SHARE.minBotShare)
    parts.push(`bot share peaked at a median ${pct(a.bot_share_60m)} (BOT_SHARE fires above ${pct(c.BOT_SHARE.minBotShare)})`);
  if (a.off_target_share_60m <= c.GEO_MISMATCH.minOffTargetShare)
    parts.push(`off-target share peaked at ${pct(a.off_target_share_60m)} (GEO_MISMATCH needs > ${pct(c.GEO_MISMATCH.minOffTargetShare)})`);
  if (a.z < c.CLICK_SPIKE.minZScore) parts.push(`the hourly z-score peaked at ${a.z} (CLICK_SPIKE needs ${c.CLICK_SPIKE.minZScore})`);
  if (a.clicks_24h_zero_signups < c.NO_CONVERSIONS.minClicks24h)
    parts.push(`the link kept converting, so NO_CONVERSIONS never saw ${c.NO_CONVERSIONS.minClicks24h} clicks with zero signups`);
  const caught = Object.entries(caughtBy).map(([r, n]) => `${r} in ${n}`).join(", ");
  const head = `${kind}: detected in ${pct(detectionRate)} of trials${caught ? ` (incidentally, by ${caught} trials)` : ""}.`;
  return parts.length ? `${head} Missing signal: ${parts.join("; ")}.` : `${head} Every rule's signal crossed its threshold in the median trial.`;
}

export function runHeldOut(opts: { seed: number; trials?: number; onProgress?: (msg: string) => void }): { summary: HeldOutSummary; details: Record<string, unknown> } {
  const trials = opts.trials ?? 30;
  const perKind: HeldOutSummary["per_kind"] = [];
  const details: Record<string, unknown[]> = {};
  for (const kind of HELD_OUT_ATTACKS) {
    const rows: { detected: boolean; ttd_min: number | null; rules_fired: string[] }[] = [];
    const approaches: Approach[] = [];
    for (let t = 0; t < trials; t++) {
      const trial = buildTrial({ seed: seedFor(opts.seed, "held_out", kind, t), nLinks: 1, attack: { kind } });
      const label = trial.label!;
      const ap: Approach = { top_ip_10m: 0, bot_share_60m: 0, off_target_share_60m: 0, z: 0, clicks_24h_zero_signups: 0 };
      const run = runDetectionTimeline(trial.events, trial.links, label.start, new Date(label.end.getTime() + 15 * 60_000), {
        onStats: (stats) => {
          const s = stats.find((x) => x.link_id === label.link_id);
          if (!s) return;
          ap.top_ip_10m = Math.max(ap.top_ip_10m, s.last10m.top_ip_clicks);
          if (s.last60m.clicks >= DETECTION_CONFIG.BOT_SHARE.minClicks) ap.bot_share_60m = Math.max(ap.bot_share_60m, s.last60m.bot_clicks / s.last60m.clicks);
          if (s.last60m.clicks >= DETECTION_CONFIG.GEO_MISMATCH.minClicks)
            ap.off_target_share_60m = Math.max(ap.off_target_share_60m, s.last60m.off_target_clicks / s.last60m.clicks);
          const z = Number(clickSpike(s, DETECTION_CONFIG).evidence.z_score ?? 0);
          if (Number.isFinite(z)) ap.z = Math.max(ap.z, round(z, 2));
          if (s.last24h.signups === 0) ap.clicks_24h_zero_signups = Math.max(ap.clicks_24h_zero_signups, s.last24h.clicks);
        },
      });
      const m = matchAttack(label, run.alerts);
      rows.push({ detected: m.detected, ttd_min: m.time_to_detect_ms === null ? null : m.time_to_detect_ms / 60_000, rules_fired: m.rules_fired });
      approaches.push(ap);
    }
    const s = summariseKind(kind, rows);
    const med = (f: (a: Approach) => number) => round(median(approaches.map(f)) ?? 0, 4);
    const typical: Approach = {
      top_ip_10m: med((a) => a.top_ip_10m),
      bot_share_60m: med((a) => a.bot_share_60m),
      off_target_share_60m: med((a) => a.off_target_share_60m),
      z: med((a) => a.z),
      clicks_24h_zero_signups: med((a) => a.clicks_24h_zero_signups),
    };
    perKind.push({ ...s, note: missingSignalNote(kind, s.detection.rate, typical, s.rules_fired) });
    details[kind] = approaches;
    opts.onProgress?.(`held_out ${kind}: ${s.detected}/${s.trials} detected`);
  }
  return { summary: { per_kind: perKind }, details: { closest_approach_per_trial: details } };
}
