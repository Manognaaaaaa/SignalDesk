import { DESIGNED_ATTACKS, type AttackKind } from "@/lib/simulate/generator";
import { falseAlarms, matchAttack } from "../matching";
import { median, percentile, round, wilson } from "../metrics";
import { runDetectionTimeline } from "../runner";
import { buildTrial, seedFor } from "../trial";
import type { KindDetection, RandomisedSummary } from "../types";

/**
 * SUITE 1 - randomised attacks.
 * Per attack kind, N trials. Each trial: 10 links, 7 days of history + 2 test days of noisy normal
 * traffic, one attack with RANDOM parameters (size, speed, IP count, countries) on a random link
 * at a random time in the test period. Cron is simulated every 5 minutes over the test period.
 */

export type TrialDetail = {
  kind: AttackKind;
  trial: number;
  params: Record<string, number>;
  start: string;
  duration_min: number;
  detected: boolean;
  ttd_min: number | null;
  rules_fired: string[];
  other_rules_in_window: string[];
  false_alarms: number;
};

export function summariseKind(kind: string, rows: { detected: boolean; ttd_min: number | null; rules_fired: string[]; false_alarms?: number }[]): KindDetection {
  const detected = rows.filter((r) => r.detected).length;
  const ttd = rows.filter((r) => r.ttd_min !== null).map((r) => r.ttd_min!);
  const rules: Record<string, number> = {};
  for (const r of rows) for (const code of r.rules_fired) rules[code] = (rules[code] ?? 0) + 1;
  const p50 = median(ttd);
  const p90 = percentile(ttd, 90);
  const ci = wilson(detected, rows.length);
  return {
    kind,
    trials: rows.length,
    detected,
    detection: { rate: round(ci.rate), low: round(ci.low), high: round(ci.high) },
    median_ttd_min: p50 === null ? null : round(p50, 1),
    p90_ttd_min: p90 === null ? null : round(p90, 1),
    rules_fired: rules,
    false_alarms_per_trial: rows.length ? round(rows.reduce((a, r) => a + (r.false_alarms ?? 0), 0) / rows.length, 3) : 0,
  };
}

export function runRandomised(opts: { seed: number; trials: number; onProgress?: (msg: string) => void }): { summary: RandomisedSummary; details: { trials: TrialDetail[] } } {
  const details: TrialDetail[] = [];
  const perKind: KindDetection[] = [];
  for (const kind of DESIGNED_ATTACKS) {
    const rows: TrialDetail[] = [];
    for (let t = 0; t < opts.trials; t++) {
      const trial = buildTrial({ seed: seedFor(opts.seed, "randomised", kind, t), nLinks: 10, attack: { kind } });
      const label = trial.label!;
      const run = runDetectionTimeline(trial.events, trial.links, trial.testStart, trial.testEnd);
      const m = matchAttack(label, run.alerts);
      rows.push({
        kind,
        trial: t,
        params: Object.fromEntries(Object.entries(label.params).map(([k, v]) => [k, round(v, 3)])),
        start: label.start.toISOString(),
        duration_min: Math.round((label.end.getTime() - label.start.getTime()) / 60_000),
        detected: m.detected,
        ttd_min: m.time_to_detect_ms === null ? null : m.time_to_detect_ms / 60_000,
        rules_fired: m.rules_fired,
        other_rules_in_window: m.any_rules_in_window.filter((r) => !m.rules_fired.includes(r)),
        false_alarms: falseAlarms(run.alerts, [label]).length,
      });
    }
    const s = summariseKind(kind, rows);
    perKind.push(s);
    details.push(...rows);
    opts.onProgress?.(`randomised ${kind}: ${s.detected}/${s.trials} detected`);
  }
  const detected = details.filter((d) => d.detected).length;
  const ci = wilson(detected, details.length);
  const ttd = details.filter((d) => d.ttd_min !== null).map((d) => d.ttd_min!);
  const med = median(ttd);
  return {
    summary: {
      trials_per_kind: opts.trials,
      overall: { rate: round(ci.rate), low: round(ci.low), high: round(ci.high), detected, trials: details.length },
      per_kind: perKind,
      median_ttd_min: med === null ? null : round(med, 1),
    },
    details: { trials: details },
  };
}
