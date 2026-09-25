import type { RuleCode } from "@/config/detection";

/**
 * One click as the detection engine sees it. Production rows and in-memory evaluation events
 * both reduce to this shape, which is what makes the evaluation describe production code.
 */
export type DetectionEvent = {
  link_id: string;
  at: Date;
  ip_hash: string;
  country_code: string | null;
  /** null = unknown (e.g. replay data has no user agent). */
  is_bot: boolean | null;
  converted_signup: boolean;
  converted_ftd: boolean;
};

export type DetectionLink = { id: string; target_countries: string[] };

export type CountryCount = { country_code: string; clicks: number };

/** Everything a rule may look at for one link as of time `as_of`. */
export type LinkWindowStats = {
  link_id: string;
  as_of: Date;
  target_countries: string[];
  last10m: { clicks: number; top_ip_clicks: number };
  last60m: {
    clicks: number;
    bot_clicks: number;
    unknown_bot_clicks: number;
    off_target_clicks: number;
    unknown_country_clicks: number;
    top_off_target_countries: CountryCount[];
  };
  last24h: { clicks: number; signups: number };
  /** Signup rate over the 7 days ending 24 h before as_of; null if fewer than the minimum clicks. */
  baseline7d_signup_rate: number | null;
  /** Clicks in the rolling last 60 minutes. */
  current_hour_clicks: number;
  /** Clicks per UTC clock hour for up to 168 hours before the current hour, oldest first. */
  hourly_history: number[];
};

export type Severity = "low" | "medium" | "high";

export type RuleResult = {
  fired: boolean;
  rule_code: RuleCode;
  link_id: string;
  severity: Severity;
  /** Floored to the rule window: this is the dedupe bucket and the alerts.window_start value. */
  window_start: Date;
  /** The as_of time the rule was evaluated at. */
  window_end: Date;
  evidence: Record<string, unknown>;
  skipped_reason?: string;
};
