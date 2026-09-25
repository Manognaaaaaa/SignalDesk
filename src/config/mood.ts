/**
 * Daily mood parameters (documented in README and on /how-it-works). Changing these changes
 * every mood score, so keep them here, not scattered through code.
 */
export const MOOD_CONFIG = {
  /** Recency weight halves every 24 hours of article age. */
  halfLifeHours: 24,
  /** How many days of mood are (re)computed on each job run. */
  days: 7,
  confidence: {
    highMinSources: 3,
    highMinAgreement: 0.7,
    mediumMinSources: 2,
  },
} as const;

/** Numeric direction of each stance; unclear/failed are excluded from mood entirely. */
export const STANCE_VALUE: Record<string, number | undefined> = {
  bullish: 1,
  hawkish: 1,
  bearish: -1,
  dovish: -1,
  neutral: 0,
};
