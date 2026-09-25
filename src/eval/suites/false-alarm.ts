import { DETECTION_CONFIG, RULE_CODES, type RuleCode } from "@/config/detection";
import type { EvalAlert } from "../matching";
import { round } from "../metrics";
import { runDetectionTimeline } from "../runner";
import { buildTrial, seedFor } from "../trial";
import type { FalseAlarmSummary } from "../types";

/**
 * SUITE 2 - false alarms on attack-free traffic.
 * 15 links, 7 warm-up days (so baselines exist, as in production) + 30 MEASURED days of normal
 * traffic including legitimate viral bumps, for 3 seeds. Every alert here is by definition false.
 */

const DAYS = 30;
const LINKS = 15;
const SEEDS = 3;

/** How far past its threshold an alert was (1.0 = exactly at threshold). Used to rank the worst cases. */
export function alertStrength(a: Pick<EvalAlert, "rule_code" | "evidence">): number {
  const e = a.evidence as Record<string, number>;
  const c = DETECTION_CONFIG;
  switch (a.rule_code) {
    case "IP_BURST":
      return (e.clicks_from_top_ip ?? 0) / c.IP_BURST.minTopIpClicks;
    case "BOT_SHARE":
      return (e.bot_share ?? 0) / c.BOT_SHARE.minBotShare;
    case "GEO_MISMATCH":
      return (e.off_target_share ?? 0) / c.GEO_MISMATCH.minOffTargetShare;
    case "NO_CONVERSIONS":
      return (e.clicks_24h ?? 0) / c.NO_CONVERSIONS.minClicks24h;
    case "CLICK_SPIKE":
      return (e.z_score ?? 0) / c.CLICK_SPIKE.minZScore;
  }
}

export type WorstCase = { seed: number; link: number; rule_code: RuleCode; severity: string; at: string; strength: number; during_viral_bump: boolean; evidence: Record<string, unknown> };

export function runFalseAlarm(opts: { seed: number; onProgress?: (msg: string) => void }): { summary: FalseAlarmSummary; details: { worst: WorstCase[]; per_seed: { seed: number; alerts: number }[] } } {
  const perRule: Record<string, number> = Object.fromEntries(RULE_CODES.map((r) => [r, 0]));
  const all: WorstCase[] = [];
  const perSeed: { seed: number; alerts: number }[] = [];
  const seeds: number[] = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = seedFor(opts.seed, "false_alarm", s);
    seeds.push(seed);
    const trial = buildTrial({ seed, nLinks: LINKS, historyDays: 7, testDays: DAYS });
    const linkIdx = new Map(trial.links.map((l, i) => [l.id, i]));
    // Viral-bump minutes per link, to tell "fired on a legitimate bump" apart from pure noise.
    const bumps = new Map<string, number[]>();
    for (const e of trial.events) if (e.scenario === "viral_bump") (bumps.get(e.link_id) ?? bumps.set(e.link_id, []).get(e.link_id)!).push(e.at.getTime());
    const run = runDetectionTimeline(trial.events, trial.links, trial.testStart, trial.testEnd);
    for (const a of run.alerts) {
      perRule[a.rule_code] = (perRule[a.rule_code] ?? 0) + 1;
      const lookback = DETECTION_CONFIG[a.rule_code].windowMinutes * 60_000;
      const t = a.at.getTime();
      all.push({
        seed,
        link: linkIdx.get(a.link_id) ?? -1,
        rule_code: a.rule_code,
        severity: a.severity,
        at: a.at.toISOString(),
        strength: round(alertStrength(a), 3),
        during_viral_bump: (bumps.get(a.link_id) ?? []).some((b) => b > t - lookback && b <= t),
        evidence: a.evidence,
      });
    }
    perSeed.push({ seed, alerts: run.alerts.length });
    opts.onProgress?.(`false_alarm seed ${s + 1}/${SEEDS}: ${run.alerts.length} false alerts over ${DAYS} days`);
  }
  const totalDays = DAYS * SEEDS;
  const total = all.length;
  const sevRank = (s: string) => (s === "high" ? 2 : s === "medium" ? 1 : 0);
  const worst = [...all].sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || b.strength - a.strength).slice(0, 5);
  return {
    summary: {
      days_measured: DAYS,
      links: LINKS,
      seeds,
      false_alerts_total: total,
      false_alerts_per_day: round(total / totalDays, 3),
      per_rule_per_day: Object.fromEntries(Object.entries(perRule).map(([k, v]) => [k, round(v / totalDays, 3)])),
      per_link_per_week: round(total / (LINKS * SEEDS * (DAYS / 7)), 4),
      during_viral_bump_share: total ? round(all.filter((a) => a.during_viral_bump).length / total, 3) : 0,
    },
    details: { worst, per_seed: perSeed },
  };
}
