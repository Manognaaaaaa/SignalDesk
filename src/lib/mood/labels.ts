import type { AssetType } from "@/config/assets-seed";

/**
 * Plain-language words for a mood score, matching the asset type's stance vocabulary.
 * Shared by the UI and the template brief (client-safe: no server imports).
 */
export function moodWord(score: number, t: AssetType): string {
  const up = t === "central_bank" ? "hawkish" : "bullish";
  const down = t === "central_bank" ? "dovish" : "bearish";
  if (score >= 0.5) return `mostly ${up}`;
  if (score >= 0.15) return `leaning ${up}`;
  if (score > -0.15) return "mixed";
  if (score > -0.5) return `leaning ${down}`;
  return `mostly ${down}`;
}

/** Short explanations of the jargon SignalDesk uses (shown in beginner mode and on /how-it-works). */
export const GLOSSARY: Record<string, string> = {
  bullish: "news that points to the price going up",
  bearish: "news that points to the price going down",
  hawkish: "a central bank leaning towards higher interest rates to fight inflation",
  dovish: "a central bank leaning towards lower interest rates to support growth",
  neutral: "the asset is mentioned but no direction is suggested",
  unclear: "the sentences do not clearly say which way it points, so we do not guess",
  yield: "the return a bond pays each year, as a percentage of its price",
};
