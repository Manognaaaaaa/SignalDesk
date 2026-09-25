import type { RuleCode } from "@/config/detection";

/** Enums the AI may choose from - and the only values the DB accepts. */
export const LIKELY_CAUSES = ["bot_traffic", "click_farm", "misconfigured_targeting", "organic_spike", "tracking_issue", "unknown"] as const;
export const RECOMMENDED_ACTIONS = ["monitor", "contact_affiliate", "pause_link", "investigate_manually"] as const;
export type LikelyCause = (typeof LIKELY_CAUSES)[number];
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export type Explanation = {
  summary: string;
  likely_cause: LikelyCause;
  recommended_action: RecommendedAction;
  explanation: string;
};

const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : "?");
const pct = (v: unknown) => (typeof v === "number" ? `${Math.round(v * 1000) / 10}%` : "?");

/**
 * Deterministic explanation per rule, filled only from evidence. Used when there is no Groq key,
 * the daily cap is reached, the model output fails validation, or it cites ungrounded numbers.
 */
export function templateExplanation(rule: RuleCode, e: Record<string, unknown>): Explanation {
  switch (rule) {
    case "IP_BURST":
      return {
        summary: `One visitor made ${num(e.clicks_from_top_ip)} of ${num(e.total_clicks_in_window)} clicks in ${num(e.window_minutes)} minutes.`,
        likely_cause: "bot_traffic",
        recommended_action: "pause_link",
        explanation: `One visitor made ${num(e.clicks_from_top_ip)} of ${num(e.total_clicks_in_window)} clicks on this link in ${num(e.window_minutes)} minutes, which looks automated. Recommended: pause the link and contact the affiliate.`,
      };
    case "BOT_SHARE":
      return {
        summary: `${pct(e.bot_share)} of ${num(e.clicks)} recent clicks came from bot user agents.`,
        likely_cause: "bot_traffic",
        recommended_action: "contact_affiliate",
        explanation: `${num(e.bot_clicks)} of ${num(e.clicks)} clicks in the last hour (${pct(e.bot_share)}) came from known bot or automation user agents. Recommended: contact the affiliate about their traffic sources.`,
      };
    case "NO_CONVERSIONS":
      return {
        summary: `${num(e.clicks_24h)} clicks in 24 hours produced ${num(e.signups_24h)} signups.`,
        likely_cause: "click_farm",
        recommended_action: "investigate_manually",
        explanation: `This link received ${num(e.clicks_24h)} clicks in the last 24 hours but ${num(e.signups_24h)} signups, although it normally converts at ${pct(e.baseline_signup_rate)}. This can mean low-quality traffic or a broken tracking setup. Recommended: investigate manually.`,
      };
    case "GEO_MISMATCH":
      return {
        summary: `${pct(e.off_target_share)} of ${num(e.clicks)} recent clicks came from non-target countries.`,
        likely_cause: "misconfigured_targeting",
        recommended_action: "contact_affiliate",
        explanation: `${num(e.off_target_clicks)} of ${num(e.clicks)} clicks in the last hour (${pct(e.off_target_share)}) came from countries this campaign does not target. Recommended: contact the affiliate to check their targeting.`,
      };
    case "CLICK_SPIKE":
      return {
        summary: `${num(e.current_hour_clicks)} clicks in the last hour versus a typical ${num(e.baseline_mean)}.`,
        likely_cause: "unknown",
        recommended_action: "monitor",
        explanation: `This link received ${num(e.current_hour_clicks)} clicks in the last hour, against an hourly average of ${num(e.baseline_mean)} (z-score ${num(e.z_score)}). It could be a genuine promotion or an attack. Recommended: monitor and check conversions.`,
      };
  }
}
