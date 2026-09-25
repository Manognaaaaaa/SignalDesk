/**
 * Detection thresholds - the ONLY place rule parameters live.
 *
 * The evaluation harness hashes this object (config_hash) and stores it with every result, so
 * each number on /evaluation is tied to the exact thresholds that produced it.
 * Rule: never tune these on held-out attacks or on replay results. If they change, rerun every suite.
 */
export const DETECTION_CONFIG = {
  IP_BURST: {
    windowMinutes: 10,
    minTopIpClicks: 20,
    severity: "high",
  },
  BOT_SHARE: {
    windowMinutes: 60,
    minClicks: 20,
    minBotShare: 0.3,
    highBotShare: 0.6,
    severity: "medium",
    highSeverity: "high",
  },
  NO_CONVERSIONS: {
    windowMinutes: 24 * 60,
    minClicks24h: 200,
    minBaselineSignupRate: 0.01,
    baselineMinClicks: 100,
    severity: "medium",
  },
  GEO_MISMATCH: {
    windowMinutes: 60,
    minClicks: 30,
    minOffTargetShare: 0.4,
    severity: "medium",
  },
  CLICK_SPIKE: {
    windowMinutes: 60,
    minHistoryPoints: 48,
    minZScore: 4,
    minCurrentClicks: 50,
    severity: "high",
  },
} as const;

export type DetectionConfig = typeof DETECTION_CONFIG;

export const RULE_CODES = ["IP_BURST", "BOT_SHARE", "NO_CONVERSIONS", "GEO_MISMATCH", "CLICK_SPIKE"] as const;
export type RuleCode = (typeof RULE_CODES)[number];

/** Plain-English rule definitions, shared by the AI prompt, templates and README. */
export const RULE_DESCRIPTIONS: Record<RuleCode, string> = {
  IP_BURST: `One hashed IP made at least ${DETECTION_CONFIG.IP_BURST.minTopIpClicks} clicks on one link within ${DETECTION_CONFIG.IP_BURST.windowMinutes} minutes.`,
  BOT_SHARE: `More than ${DETECTION_CONFIG.BOT_SHARE.minBotShare * 100}% of at least ${DETECTION_CONFIG.BOT_SHARE.minClicks} clicks in the last ${DETECTION_CONFIG.BOT_SHARE.windowMinutes} minutes came from bot user agents (high severity above ${DETECTION_CONFIG.BOT_SHARE.highBotShare * 100}%).`,
  NO_CONVERSIONS: `At least ${DETECTION_CONFIG.NO_CONVERSIONS.minClicks24h} clicks in 24 hours produced zero signups although the link's 7-day baseline signup rate was at least ${DETECTION_CONFIG.NO_CONVERSIONS.minBaselineSignupRate * 100}%.`,
  GEO_MISMATCH: `More than ${DETECTION_CONFIG.GEO_MISMATCH.minOffTargetShare * 100}% of at least ${DETECTION_CONFIG.GEO_MISMATCH.minClicks} clicks in the last ${DETECTION_CONFIG.GEO_MISMATCH.windowMinutes} minutes came from countries the campaign does not target.`,
  CLICK_SPIKE: `Clicks in the last 60 minutes were at least ${DETECTION_CONFIG.CLICK_SPIKE.minZScore} standard deviations above the link's hourly history (needs ${DETECTION_CONFIG.CLICK_SPIKE.minHistoryPoints}+ hours of history and ${DETECTION_CONFIG.CLICK_SPIKE.minCurrentClicks}+ clicks).`,
};
