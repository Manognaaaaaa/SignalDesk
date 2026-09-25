import type { AssetType } from "@/config/assets-seed";
import { moodWord } from "@/lib/mood/labels";

/**
 * Deterministic brief used when there is no Groq key, the daily cap is hit, the model fails, or
 * fewer than 2 model bullets survive the checks. Built only from daily_mood numbers.
 */

export type BriefBullet = { text: string; asset_slugs: string[]; article_ids: string[] };
export type TemplateAsset = { slug: string; name: string; asset_type: AssetType };
export type TemplateMood = { score: number; confidence: string; source_count: number };

export function templateBrief(assets: TemplateAsset[], moods: Map<string, TemplateMood>, level: "standard" | "beginner"): BriefBullet[] {
  const bullets: BriefBullet[] = [];
  for (const a of assets.slice(0, 5)) {
    const m = moods.get(a.slug);
    if (!m) {
      bullets.push({ text: `${a.name}: no scored news yet today.`, asset_slugs: [a.slug], article_ids: [] });
      continue;
    }
    const word = moodWord(m.score, a.asset_type);
    const plain =
      level === "beginner" && word !== "mixed"
        ? ` (${word.includes("hawkish") ? "hawkish = leaning towards higher rates" : word.includes("dovish") ? "dovish = leaning towards lower rates" : word.includes("bullish") ? "bullish = news pointing up" : "bearish = news pointing down"})`
        : "";
    bullets.push({
      text: `${a.name}: ${word} today${plain}, ${m.source_count} source${m.source_count === 1 ? "" : "s"}, ${m.confidence} confidence.`,
      asset_slugs: [a.slug],
      article_ids: [],
    });
  }
  return bullets;
}
