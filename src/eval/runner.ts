import { DETECTION_CONFIG, type RuleCode } from "@/config/detection";
import { AlertDeduper, evaluate } from "@/lib/detection/engine";
import { StatsTimeline } from "@/lib/detection/stats-memory";
import type { DetectionEvent, DetectionLink, LinkWindowStats } from "@/lib/detection/types";
import type { EvalAlert } from "./matching";

/**
 * Simulated cron: evaluates the PRODUCTION rules (engine.evaluate) on in-memory stats at every
 * 5-minute checkpoint, deduping across checkpoints exactly like the alerts UNIQUE constraint.
 * Checkpoints are aligned to wall-clock multiples of 5 minutes, as pg_cron would run them.
 */

export const STEP_MS = 5 * 60_000;

export type RunOutput = { alerts: EvalAlert[]; skippedByRule: Partial<Record<RuleCode, number>>; checkpoints: number };

export function runCheckpoints(
  timeline: StatsTimeline,
  from: Date,
  to: Date,
  opts: { onStats?: (stats: LinkWindowStats[], at: Date) => void; linkFilter?: (linkId: string) => boolean } = {},
): RunOutput {
  const dedupe = new AlertDeduper();
  const alerts: EvalAlert[] = [];
  const skippedByRule: Partial<Record<RuleCode, number>> = {};
  let checkpoints = 0;
  const first = Math.ceil(from.getTime() / STEP_MS) * STEP_MS;
  for (let t = first; t <= to.getTime(); t += STEP_MS) {
    const at = new Date(t);
    let stats = timeline.statsAt(at);
    if (opts.linkFilter) stats = stats.filter((s) => opts.linkFilter!(s.link_id));
    opts.onStats?.(stats, at);
    const out = evaluate(stats, DETECTION_CONFIG);
    for (const [k, v] of Object.entries(out.skippedByRule)) skippedByRule[k as RuleCode] = (skippedByRule[k as RuleCode] ?? 0) + (v ?? 0);
    for (const r of dedupe.filterNew(out.fired)) {
      alerts.push({ link_id: r.link_id, rule_code: r.rule_code, severity: r.severity, at, window_start: r.window_start, evidence: r.evidence });
    }
    checkpoints++;
  }
  return { alerts, skippedByRule, checkpoints };
}

/** Convenience: build a timeline and run checkpoints over [from, to]. */
export function runDetectionTimeline(events: DetectionEvent[], links: DetectionLink[], from: Date, to: Date, opts?: Parameters<typeof runCheckpoints>[3]): RunOutput {
  return runCheckpoints(new StatsTimeline(events, links), from, to, opts);
}
