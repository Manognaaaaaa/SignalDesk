import type { AssetType } from "@/config/assets-seed";

/** Plain data shapes passed from server pages to client components (public news data only). */

export type AssetRow = { id: string; slug: string; name: string; asset_type: AssetType; description_simple: string };
export type MoodPoint = { day: string; score: number | null; confidence: "low" | "medium" | "high" | null; source_count: number; article_count: number };
export type StoryArticle = { id: string; title: string; url: string; source: string; at: string; stance: string | null; strength: number | null; status: string | null };
export type StoryGroup = { story_id: string; headline: string; source_count: number; article_count: number; last_at: string; articles: StoryArticle[] };
export type SentenceRow = { id: string; text: string };
export type SignalWithEvidence = {
  article_id: string;
  title: string;
  url: string;
  source: string;
  at: string;
  stance: string;
  strength: number;
  status: string;
  why: string;
  evidence_ids: string[];
  sentences: SentenceRow[];
};
