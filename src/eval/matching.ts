import { DETECTION_CONFIG, RULE_CODES, type RuleCode } from "@/config/detection";
import type { AttackKind, AttackLabel } from "@/lib/simulate/generator";
import type { Severity } from "@/lib/detection/types";

/**
 * Attack-to-alert matching: the definitions every evaluation number rests on.
 *
 *  DETECTED      an alert on the attacked link, with one of the attack kind's EXPECTED rules,
 *                raised at a checkpoint inside [attack start, attack end + 15 min].
 *  TIME TO DETECT first such alert time - attack start.
 *  FALSE ALARM   an alert that no attack can explain: it is not on an attacked link while that
 *                attack's clicks were inside the rule's own look-back window.
 *
 * Held-out kinds have no "expected" rule (the rules were not designed for them), so ANY rule on
 * the attacked link inside the window counts - the most generous possible reading.
 */

export const GRACE_MS = 15 * 60_000;

export const EXPECTED_RULES: Record<AttackKind, readonly RuleCode[]> = {
  bot_burst: ["IP_BURST", "BOT_SHARE"],
  click_farm: ["GEO_MISMATCH", "NO_CONVERSIONS"],
  spike: ["CLICK_SPIKE"],
  slow_drip: RULE_CODES,
  distributed_bots: RULE_CODES,
};

/** An alert as produced by the simulated cron: `at` is the checkpoint time it was raised. */
export type EvalAlert = {
  link_id: string;
  rule_code: RuleCode;
  severity: Severity;
  at: Date;
  window_start: Date;
  evidence: Record<string, unknown>;
};

export type MatchResult = {
  detected: boolean;
  first_alert_at: Date | null;
  time_to_detect_ms: number | null;
  /** Expected rules that fired in the window (distinct, in firing order). */
  rules_fired: RuleCode[];
  /** Every rule that fired on the attacked link in the window, expected or not. */
  any_rules_in_window: RuleCode[];
};

/** Matches one attack label against all alerts of a run. */
export function matchAttack(label: Pick<AttackLabel, "kind" | "link_id" | "start" | "end">, alerts: EvalAlert[]): MatchResult {
  const from = label.start.getTime();
  const to = label.end.getTime() + GRACE_MS;
  const expected = EXPECTED_RULES[label.kind];
  const inWindow = alerts
    .filter((a) => a.link_id === label.link_id && a.at.getTime() >= from && a.at.getTime() <= to)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const hits = inWindow.filter((a) => expected.includes(a.rule_code));
  const first = hits[0] ?? null;
  return {
    detected: first !== null,
    first_alert_at: first ? first.at : null,
    time_to_detect_ms: first ? first.at.getTime() - from : null,
    rules_fired: [...new Set(hits.map((a) => a.rule_code))],
    any_rules_in_window: [...new Set(inWindow.map((a) => a.rule_code))],
  };
}

/**
 * True if the alert can be attributed to a labelled attack: same link, and the rule's look-back
 * window (at - window, at] overlaps the attack [start, end]. Such alerts are not false alarms,
 * even if they fire after the detection grace period (e.g. NO_CONVERSIONS looks back 24 h).
 */
export function explainedByAttack(alert: EvalAlert, labels: Pick<AttackLabel, "link_id" | "start" | "end">[]): boolean {
  const lookback = DETECTION_CONFIG[alert.rule_code].windowMinutes * 60_000;
  const t = alert.at.getTime();
  return labels.some((l) => l.link_id === alert.link_id && t >= l.start.getTime() && t - lookback < l.end.getTime());
}

/** Alerts with no attack to explain them. */
export function falseAlarms(alerts: EvalAlert[], labels: Pick<AttackLabel, "link_id" | "start" | "end">[]): EvalAlert[] {
  return alerts.filter((a) => !explainedByAttack(a, labels));
}
