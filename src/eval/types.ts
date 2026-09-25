import type { Interval } from "./metrics";

/** Result shapes shared by the harness, eval_runs rows, the README table and /evaluation. */

export type EvalKind = "randomised" | "false_alarm" | "sensitivity" | "held_out" | "replay" | "load_test" | "security";

export type EvalRecord<S = Record<string, unknown>, D = Record<string, unknown>> = {
  kind: EvalKind;
  created_at: string;
  git_sha: string | null;
  config_hash: string;
  seed: number | null;
  summary: S;
  details: D;
};

export type KindDetection = {
  kind: string;
  trials: number;
  detected: number;
  detection: Interval;
  median_ttd_min: number | null;
  p90_ttd_min: number | null;
  rules_fired: Record<string, number>;
  false_alarms_per_trial: number;
};

export type RandomisedSummary = {
  trials_per_kind: number;
  overall: Interval & { detected: number; trials: number };
  per_kind: KindDetection[];
  median_ttd_min: number | null;
};

export type FalseAlarmSummary = {
  days_measured: number;
  links: number;
  seeds: number[];
  false_alerts_total: number;
  false_alerts_per_day: number;
  per_rule_per_day: Record<string, number>;
  per_link_per_week: number;
  during_viral_bump_share: number;
};

export type SensitivitySeries = {
  kind: string;
  parameter: string;
  levels: { level: number; trials: number; detected: number; detection: Interval }[];
  breaking_point: number | null;
};
export type SensitivitySummary = { trials_per_level: number; series: SensitivitySeries[] };

export type HeldOutSummary = {
  per_kind: (KindDetection & { note: string })[];
};

export type ReplaySummary = {
  skipped: boolean;
  message?: string;
  rows_read?: number;
  rows_valid?: number;
  rows_malformed?: number;
  links?: number;
  unique_ips?: number;
  time_span_hours?: number;
  alerts_by_rule?: Record<string, number>;
  not_applicable_rules?: string[];
  coverage_share?: number;
  flagged?: { clicks: number; attributed: number; rate: number };
  unflagged?: { clicks: number; attributed: number; rate: number };
  attribution_ratio?: number | null;
  z_test?: { z: number; p_value: number };
  burst_ips?: { ips: number; clicks: number; rate: number; other_rate: number; ratio: number | null; p_value: number };
};

export type LoadTestSummary = {
  url_host: string;
  connections: number;
  duration_s: number;
  requests: number;
  requests_per_sec: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  non_302: number;
  errors: number;
};

export type SecurityCheck = { name: string; category: string; pass: boolean; detail: string };
export type SecuritySummary = { passed: number; total: number; target_host: string };
