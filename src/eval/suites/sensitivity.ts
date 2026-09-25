import { sampleAttackParams, type AttackKind, type AttackParams } from "@/lib/simulate/generator";
import { uniform, randInt, type Rng } from "@/lib/simulate/prng";
import { matchAttack } from "../matching";
import { round, wilson } from "../metrics";
import { runDetectionTimeline } from "../runner";
import { buildTrial, seedFor } from "../trial";
import type { SensitivitySeries, SensitivitySummary } from "../types";

/**
 * SUITE 3 - sensitivity sweep ("breaking point").
 * Varies ONE attack parameter over fixed levels while the others stay random, and reports the
 * detection rate per level. Breaking point = the lowest level from which detection stays >= 90%
 * at every higher level (equal to "lowest level >= 90%" when the curve is monotone).
 * Detection is per-link, so each trial simulates only the attacked link (7 + 2 days).
 */

type Sweep = { kind: AttackKind; parameter: string; levels: number[]; params: (rng: Rng, level: number) => AttackParams };

export const SWEEPS: Sweep[] = [
  {
    kind: "bot_burst",
    parameter: "clicks_per_10min (single IP)",
    levels: [5, 10, 15, 20, 25, 30, 40, 60],
    params: (rng, level) => ({ ip_count: 1, clicks_per_10min: level, bot_share: uniform(rng, 0.6, 1.0), duration_min: randInt(rng, 10, 40) }),
  },
  {
    kind: "spike",
    parameter: "multiplier of normal hourly volume",
    levels: [1.5, 2, 3, 4, 6, 8, 12],
    params: (rng, level) => ({ ...sampleAttackParams("spike", rng), multiplier: level }),
  },
  {
    kind: "click_farm",
    parameter: "off_target_share",
    levels: [0.2, 0.3, 0.4, 0.5, 0.7, 0.9],
    params: (rng, level) => ({ ...sampleAttackParams("click_farm", rng), off_target_share: level }),
  },
];

/** Lowest level from which every level (inclusive, upwards) reaches the target rate. */
export function breakingPoint(levels: { level: number; rate: number }[], target = 0.9): number | null {
  let bp: number | null = null;
  for (let i = levels.length - 1; i >= 0; i--) {
    if (levels[i]!.rate >= target) bp = levels[i]!.level;
    else break;
  }
  return bp;
}

export function runSensitivity(opts: { seed: number; trials?: number; onProgress?: (msg: string) => void }): { summary: SensitivitySummary; details: Record<string, unknown> } {
  const trials = opts.trials ?? 20;
  const series: SensitivitySeries[] = [];
  for (const sweep of SWEEPS) {
    const levels: SensitivitySeries["levels"] = [];
    for (const level of sweep.levels) {
      let detected = 0;
      for (let t = 0; t < trials; t++) {
        const trial = buildTrial({
          seed: seedFor(opts.seed, "sensitivity", sweep.kind, level, t),
          nLinks: 1,
          attack: { kind: sweep.kind, params: (rng) => sweep.params(rng, level) },
        });
        const label = trial.label!;
        // Only the attack window (+ grace) matters for detection; skip the rest of the timeline.
        const run = runDetectionTimeline(trial.events, trial.links, label.start, new Date(label.end.getTime() + 15 * 60_000));
        if (matchAttack(label, run.alerts).detected) detected++;
      }
      const ci = wilson(detected, trials);
      levels.push({ level, trials, detected, detection: { rate: round(ci.rate), low: round(ci.low), high: round(ci.high) } });
    }
    const bp = breakingPoint(levels.map((l) => ({ level: l.level, rate: l.detection.rate })));
    series.push({ kind: sweep.kind, parameter: sweep.parameter, levels, breaking_point: bp });
    opts.onProgress?.(`sensitivity ${sweep.kind}: breaking point ${bp ?? "not reached"}`);
  }
  return { summary: { trials_per_level: trials, series }, details: {} };
}
