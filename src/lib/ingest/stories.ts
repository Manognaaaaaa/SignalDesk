/**
 * Deterministic story grouping: articles about the same story from different outlets are joined
 * when their normalised titles are similar (Jaccard >= 0.5 over word 3-shingles) within 48 hours.
 * No embeddings, no LLM: cheap, explainable and reproducible.
 */

export const STORY_WINDOW_MS = 48 * 3_600_000;
export const JOIN_THRESHOLD = 0.5;

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or over says said than that the their this to up was were will with after amid as but".split(" "),
);

/** Lower-cases, strips punctuation and stopwords. */
export function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOPWORDS.has(w));
}

/** Word 3-shingles; titles with fewer than 3 content words fall back to single words. */
export function shingles(title: string): Set<string> {
  const w = titleWords(title);
  if (w.length < 3) return new Set(w);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export type StoryCandidate = { story_id: string; title: string; at: number };
export type NewArticle = { article_id: string; title: string; at: number };
export type StoryAssignment = { article_id: string; story_id: string; is_new_story: boolean; similarity: number };

/**
 * Assigns each new article (processed oldest first) to the most similar story seen in the
 * previous 48 hours, or to a brand-new story. New stories become candidates for later articles
 * in the same batch. `newId` creates story ids (injected for tests).
 */
export function assignStories(newArticles: NewArticle[], recent: StoryCandidate[], newId: () => string): StoryAssignment[] {
  const pool = recent.map((c) => ({ ...c, sh: shingles(c.title) }));
  const out: StoryAssignment[] = [];
  for (const a of [...newArticles].sort((x, y) => x.at - y.at)) {
    const sh = shingles(a.title);
    let best: { story_id: string; sim: number } | null = null;
    for (const c of pool) {
      if (Math.abs(a.at - c.at) > STORY_WINDOW_MS) continue;
      const sim = jaccard(sh, c.sh);
      if (sim >= JOIN_THRESHOLD && (!best || sim > best.sim)) best = { story_id: c.story_id, sim };
    }
    const story_id = best ? best.story_id : newId();
    out.push({ article_id: a.article_id, story_id, is_new_story: !best, similarity: best ? Math.round(best.sim * 1000) / 1000 : 1 });
    pool.push({ story_id, title: a.title, at: a.at, sh });
  }
  return out;
}
