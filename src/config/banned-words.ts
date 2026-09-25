/**
 * Phrases that turn information into advice or prediction. Any brief bullet containing one of
 * these (whole-word, case-insensitive) is dropped - SignalDesk never tells anyone what to do.
 */
export const BANNED_PHRASES = ["buy", "sell", "should", "guaranteed", "will rise", "will fall", "price target"] as const;

/** Returns the first banned phrase found as whole words (e.g. "sell" matches, "selling" does not), else null. */
export function containsBannedPhrase(text: string): string | null {
  // Market-news nouns are reporting, not advice: "a sell-off", "share buy-backs".
  const cleaned = text.replace(/\b(sell-?offs?|buy-?backs?)\b/gi, " ");
  for (const p of BANNED_PHRASES) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(cleaned)) return p;
  }
  return null;
}

export const DISCLAIMER = "Market information only. Not financial advice.";
export const FOOTER_TEXT = "Market information only. Not financial advice. Headlines belong to their publishers.";
