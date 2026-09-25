import { DETECTION_CONFIG, type DetectionConfig, type RuleCode } from "@/config/detection";
import { RULES } from "./rules";
import type { LinkWindowStats, RuleResult } from "./types";

/**
 * The detection engine: runs every rule over every link's stats.
 * It is data-source agnostic - production feeds it stats from SQL, the evaluation harness feeds
 * it stats computed in memory - so there is exactly one implementation of "what is fraud".
 */

/** Dedupe key: one alert per (link, rule, rule-window bucket). Mirrors the alerts UNIQUE constraint. */
export function dedupeKey(r: Pick<RuleResult, "link_id" | "rule_code" | "window_start">): string {
  return `${r.link_id}|${r.rule_code}|${r.window_start.toISOString()}`;
}

export type EvaluationOutcome = {
  fired: RuleResult[];
  skippedByRule: Partial<Record<RuleCode, number>>;
};

/** Runs all rules and returns fired results (deduped) plus how often each rule skipped. */
export function evaluate(statsList: LinkWindowStats[], config: DetectionConfig = DETECTION_CONFIG): EvaluationOutcome {
  const fired: RuleResult[] = [];
  const seen = new Set<string>();
  const skippedByRule: Partial<Record<RuleCode, number>> = {};
  for (const stats of statsList) {
    for (const rule of RULES) {
      const r = rule(stats, config);
      if (r.skipped_reason) skippedByRule[r.rule_code] = (skippedByRule[r.rule_code] ?? 0) + 1;
      if (!r.fired) continue;
      const key = dedupeKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      fired.push(r);
    }
  }
  return { fired, skippedByRule };
}

/** detect(): fired rule results only, deduped within this batch. */
export function detect(statsList: LinkWindowStats[], config: DetectionConfig = DETECTION_CONFIG): RuleResult[] {
  return evaluate(statsList, config).fired;
}

/**
 * Stateful deduper for simulated cron runs: remembers keys across checkpoints so an ongoing
 * incident produces one alert per rule window, exactly like ON CONFLICT DO NOTHING in production.
 */
export class AlertDeduper {
  private readonly seen = new Set<string>();
  /** Returns only results not seen before, and remembers them. */
  filterNew(results: RuleResult[]): RuleResult[] {
    const out: RuleResult[] = [];
    for (const r of results) {
      const k = dedupeKey(r);
      if (this.seen.has(k)) continue;
      this.seen.add(k);
      out.push(r);
    }
    return out;
  }
}
