import "server-only";
import { MOOD_CONFIG } from "@/config/mood";
import { supabaseServer } from "@/lib/supabase/server";
import type { AssetRow, MoodPoint, SignalWithEvidence, StoryGroup } from "@/lib/ui-types";

/**
 * Read models for pages. Queries run through the per-request client (anon key + the user's
 * cookie), so RLS decides visibility: public news tables for everyone, watchlist/settings/briefs
 * for their owner only. Pages only READ precomputed data - no fetching or AI happens here.
 * Failures return empty results so pages show empty states instead of errors.
 */

type SourceJoin = { name: string } | { name: string }[] | null;
const sourceName = (s: SourceJoin) => (Array.isArray(s) ? s[0]?.name : s?.name) ?? "Unknown source";
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

export async function getCatalogue(): Promise<AssetRow[]> {
  const db = await supabaseServer();
  const { data } = await db.from("assets").select("id, slug, name, asset_type, description_simple").order("asset_type").order("name");
  return (data ?? []) as AssetRow[];
}

export async function getAssetBySlug(slug: string): Promise<AssetRow | null> {
  const db = await supabaseServer();
  const { data } = await db.from("assets").select("id, slug, name, asset_type, description_simple").eq("slug", slug).maybeSingle();
  return (data as AssetRow | null) ?? null;
}

/** Last N UTC days (oldest first), zero-filled with null scores where no mood exists. */
export async function getMoodSeries(assetIds: string[], days: number = MOOD_CONFIG.days, now: Date = new Date()): Promise<Map<string, MoodPoint[]>> {
  const out = new Map<string, MoodPoint[]>();
  if (assetIds.length === 0) return out;
  const dayList = Array.from({ length: days }, (_, i) => new Date(now.getTime() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const db = await supabaseServer();
  const { data } = await db
    .from("daily_mood")
    .select("asset_id, day, score, confidence, source_count, article_count")
    .in("asset_id", assetIds)
    .gte("day", dayList[0]!);
  const rows = (data ?? []) as { asset_id: string; day: string; score: number | string; confidence: MoodPoint["confidence"]; source_count: number; article_count: number }[];
  for (const id of assetIds) {
    out.set(
      id,
      dayList.map((day) => {
        const r = rows.find((x) => x.asset_id === id && x.day === day);
        return r
          ? { day, score: Number(r.score), confidence: r.confidence, source_count: r.source_count, article_count: r.article_count }
          : { day, score: null, confidence: null, source_count: 0, article_count: 0 };
      }),
    );
  }
  return out;
}

type MentionJoin = {
  article_id: string;
  articles: {
    id: string;
    title: string;
    url: string;
    published_at: string | null;
    fetched_at: string;
    story_id: string | null;
    sources: SourceJoin;
    stories: { headline: string; article_count: number; source_count: number } | { headline: string; article_count: number; source_count: number }[] | null;
  };
};

/** Stories mentioning an asset in the last `hours`, most-covered first, each with its articles and stance. */
export async function getStoriesForAsset(assetId: string, hours = 48, limit = 20): Promise<StoryGroup[]> {
  const db = await supabaseServer();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data } = await db
    .from("asset_mentions")
    .select("article_id, articles!inner(id, title, url, published_at, fetched_at, story_id, sources(name), stories(headline, article_count, source_count))")
    .eq("asset_id", assetId)
    .gte("articles.fetched_at", since)
    .limit(300);
  const mentions = (data ?? []) as unknown as MentionJoin[];
  if (mentions.length === 0) return [];
  const { data: sigs } = await db
    .from("asset_signals")
    .select("article_id, stance, strength, status")
    .eq("asset_id", assetId)
    .in("article_id", mentions.map((m) => m.article_id));
  const sigBy = new Map((sigs ?? []).map((s) => [s.article_id as string, s as { stance: string; strength: number; status: string }]));

  const groups = new Map<string, StoryGroup>();
  for (const m of mentions) {
    const a = m.articles;
    const key = a.story_id ?? `article:${a.id}`;
    const st = one(a.stories);
    const at = a.published_at ?? a.fetched_at;
    const g = groups.get(key) ?? {
      story_id: key,
      headline: st?.headline ?? a.title,
      source_count: st?.source_count ?? 1,
      article_count: st?.article_count ?? 1,
      last_at: at,
      articles: [],
    };
    const s = sigBy.get(a.id);
    g.articles.push({ id: a.id, title: a.title, url: a.url, source: sourceName(a.sources), at, stance: s?.stance ?? null, strength: s?.strength ?? null, status: s?.status ?? null });
    if (at > g.last_at) g.last_at = at;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, articles: g.articles.sort((x, y) => y.at.localeCompare(x.at)) }))
    .sort((a, b) => b.source_count - a.source_count || b.last_at.localeCompare(a.last_at))
    .slice(0, limit);
}

/** Every signal for an asset in the last `days`, newest first, with its stored sentences. */
export async function getSignalsForAsset(assetId: string, days = 7): Promise<SignalWithEvidence[]> {
  const db = await supabaseServer();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db
    .from("asset_signals")
    .select("article_id, stance, strength, status, why, evidence_ids, articles!inner(title, url, published_at, fetched_at, sources(name))")
    .eq("asset_id", assetId)
    .gte("articles.fetched_at", since)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as {
    article_id: string;
    stance: string;
    strength: number;
    status: string;
    why: string;
    evidence_ids: string[];
    articles: { title: string; url: string; published_at: string | null; fetched_at: string; sources: SourceJoin };
  }[];
  if (rows.length === 0) return [];
  const { data: ms } = await db.from("asset_mentions").select("article_id, sentences").eq("asset_id", assetId).in("article_id", rows.map((r) => r.article_id));
  const sentences = new Map((ms ?? []).map((m) => [m.article_id as string, m.sentences as { id: string; text: string }[]]));
  return rows.map((r) => ({
    article_id: r.article_id,
    title: r.articles.title,
    url: r.articles.url,
    source: sourceName(r.articles.sources),
    at: r.articles.published_at ?? r.articles.fetched_at,
    stance: r.stance,
    strength: r.strength,
    status: r.status,
    why: r.why,
    evidence_ids: r.evidence_ids,
    sentences: sentences.get(r.article_id) ?? [],
  }));
}

/** The signed-in user's watchlist (RLS: own rows only). */
export async function getWatchlist(): Promise<AssetRow[]> {
  const db = await supabaseServer();
  const { data } = await db.from("watchlists").select("added_at, assets(id, slug, name, asset_type, description_simple)").order("added_at");
  return (data ?? []).map((r) => one(r.assets as AssetRow | AssetRow[])).filter((a): a is AssetRow => a !== null);
}

export async function getBeginnerMode(): Promise<boolean> {
  const db = await supabaseServer();
  const { data } = await db.from("user_settings").select("beginner_mode").maybeSingle();
  return Boolean(data?.beginner_mode);
}

/** True once the pipeline has produced at least one stance (used for the "AI scoring offline" label). */
export async function hasAnySignals(): Promise<boolean> {
  const db = await supabaseServer();
  const { count } = await db.from("asset_signals").select("article_id", { count: "exact", head: true });
  return (count ?? 0) > 0;
}
