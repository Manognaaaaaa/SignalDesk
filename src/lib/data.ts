import "server-only";
import { MOOD_CONFIG } from "@/config/mood";
import { supabaseServer } from "@/lib/supabase/server";
import type { ActiveAsset, AssetRow, LastSignal, MoodPoint, Receipt, SignalWithEvidence, SiteStats, StoryGroup } from "@/lib/ui-types";

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

type SignalJoinRow = {
  article_id: string;
  asset_id: string;
  stance: string;
  strength: number;
  status: string;
  why: string;
  evidence_ids: string[];
  assets: { slug: string; name: string; asset_type: AssetRow["asset_type"] } | { slug: string; name: string; asset_type: AssetRow["asset_type"] }[] | null;
  articles: { title: string; url: string; published_at: string | null; fetched_at: string; sources: SourceJoin } | null;
};

/**
 * The newest directional signal (not unclear/neutral) from the last 48 h, with its stored
 * sentences: the landing page shows it as a real example of a "receipt".
 */
export async function getLatestReceipt(): Promise<Receipt | null> {
  const db = await supabaseServer();
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const { data } = await db
    .from("asset_signals")
    .select("article_id, asset_id, stance, strength, status, why, evidence_ids, assets(slug, name, asset_type), articles!inner(title, url, published_at, fetched_at, sources(name))")
    .eq("status", "ok")
    .in("stance", ["bullish", "bearish", "hawkish", "dovish"])
    .gte("strength", 2)
    .gte("articles.fetched_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const r = (data?.[0] ?? null) as unknown as SignalJoinRow | null;
  const asset = r ? one(r.assets) : null;
  if (!r || !r.articles || !asset) return null;
  const { data: m } = await db.from("asset_mentions").select("sentences").eq("article_id", r.article_id).eq("asset_id", r.asset_id).maybeSingle();
  return {
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
    sentences: (m?.sentences as { id: string; text: string }[] | undefined) ?? [],
    asset,
  };
}

/**
 * Assets ranked by how many scored signals they had in the last `hours`, each with its latest
 * scored stance (any age within 7 days) so quiet days can say "last signal 2 d ago · bearish".
 */
export async function getActiveAssets(catalogue: AssetRow[], hours = 48): Promise<ActiveAsset[]> {
  const db = await supabaseServer();
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const cutoff = Date.now() - hours * 3_600_000;
  const { data } = await db
    .from("asset_signals")
    .select("asset_id, stance, status, articles!inner(published_at, fetched_at)")
    .neq("status", "failed")
    .gte("articles.fetched_at", week)
    .order("created_at", { ascending: false })
    .limit(1000);
  const rows = (data ?? []) as unknown as { asset_id: string; stance: string; status: string; articles: { published_at: string | null; fetched_at: string } }[];
  const byAsset = new Map<string, { signals: number; last: LastSignal | null }>();
  for (const r of rows) {
    const at = r.articles.published_at ?? r.articles.fetched_at;
    const e = byAsset.get(r.asset_id) ?? { signals: 0, last: null };
    if (Date.parse(r.articles.fetched_at) >= cutoff) e.signals++;
    if (r.stance !== "unclear" && (!e.last || at > e.last.at)) e.last = { stance: r.stance, at };
    byAsset.set(r.asset_id, e);
  }
  return catalogue
    .map((asset) => ({ asset, signals: byAsset.get(asset.id)?.signals ?? 0, last: byAsset.get(asset.id)?.last ?? null }))
    .sort((a, b) => b.signals - a.signals || (b.last?.at ?? "").localeCompare(a.last?.at ?? ""));
}

/** Live counts for the landing page (all computed from stored rows, never hardcoded). */
export async function getSiteStats(): Promise<SiteStats> {
  const db = await supabaseServer();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  const [sources, articles, assets, signals, latest] = await Promise.all([
    db.from("sources").select("id", { count: "exact", head: true }).eq("is_active", true),
    db.from("articles").select("id", { count: "exact", head: true }).gte("fetched_at", day),
    db.from("assets").select("id", { count: "exact", head: true }),
    db.from("asset_signals").select("article_id", { count: "exact", head: true }).gte("created_at", day),
    db.from("sources").select("last_fetched_at").not("last_fetched_at", "is", null).order("last_fetched_at", { ascending: false }).limit(1),
  ]);
  return {
    sources: sources.count ?? 0,
    articles24h: articles.count ?? 0,
    assets: assets.count ?? 0,
    signals24h: signals.count ?? 0,
    lastUpdated: (latest.data?.[0]?.last_fetched_at as string | undefined) ?? null,
  };
}
