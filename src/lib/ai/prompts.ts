import type { AssetType } from "@/config/assets-seed";

/**
 * Prompt construction. Security posture: the model has no tools and only ever sees numbered
 * sentences inside <sentences> (or signals inside <signals>), declared as untrusted data.
 * Angle brackets in untrusted text are neutralised so it cannot close the tag.
 * The stance prompt text itself is versioned in ./stance-prompts/.
 */

export const CENTRAL_BANK_STANCES = ["hawkish", "dovish", "neutral", "unclear"] as const;
export const MARKET_STANCES = ["bullish", "bearish", "neutral", "unclear"] as const;
export type Stance = (typeof CENTRAL_BANK_STANCES)[number] | (typeof MARKET_STANCES)[number];

/** Stance labels that fit an asset type: central banks are hawkish/dovish, everything else bullish/bearish. */
export function allowedStances(t: AssetType): readonly Stance[] {
  return t === "central_bank" ? CENTRAL_BANK_STANCES : MARKET_STANCES;
}

/** Neutralises characters that could break out of a tagged data block. */
export const sanitize = (s: string) => s.replace(/[<>]/g, " ");
