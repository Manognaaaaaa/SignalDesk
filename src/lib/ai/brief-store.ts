import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArticleMeta, BriefSignal, BriefStore, MoodToday, StoredBrief, WatchAsset } from "./brief";

/**
 * Supabase implementation of BriefStore. It runs with the service role (briefs are written only
 * by the server), so EVERY query is explicitly filtered by the user id taken from the session.
 */

type SourceJoin = { name: string } | { name: string }[] | null;
const sourceName = (s: SourceJoin) => (Array.isArray(s) ? s[0]?.name : s?.name) ?? "Unknown source";

export function supabaseBriefStore(db: SupabaseClient): BriefStore {
  return {
    async getWatchlist(userId) {
      const { data, error } = await db.from("watchlists").select("assets(id, slug, name, asset_type)").eq("user_id", userId);
      if (error) throw new Error("watchlist read failed");
      return (data ?? []).map((r) => (Array.isArray(r.assets) ? r.assets[0] : r.assets) as WatchAsset).filter(Boolean);
    },
    async getCached(userId, day, level, hash) {
      const { data } = await db.from("briefs").select("bullets, source").eq("user_id", userId).eq("day", day).eq("level", level).eq("watchlist_hash", hash).maybeSingle();
      return (data as StoredBrief | null) ?? null;
    },
    async countGeneratedToday(userId, day) {
      const { count } = await db.from("briefs").select("user_id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", `${day}T00:00:00Z`);
      return count ?? 0;
    },
    async getMoods(assetIds, day) {
      const { data } = await db.from("daily_mood").select("asset_id, score, confidence, source_count, article_count").in("asset_id", assetIds).eq("day", day);
      return ((data ?? []) as MoodToday[]).map((m) => ({ ...m, score: Number(m.score) }));
    },
    async getSignals(assetIds, sinceIso) {
      const { data, error } = await db
        .from("asset_signals")
        .select("asset_id, article_id, stance, strength, why, evidence_ids, articles!inner(title, url, published_at, fetched_at, sources(name))")
        .in("asset_id", assetIds)
        .eq("status", "ok")
        .gte("articles.fetched_at", sinceIso)
        .limit(500);
      if (error || !data) return [];
      const rows = data as unknown as {
        asset_id: string;
        article_id: string;
        stance: string;
        strength: number;
        why: string;
        evidence_ids: string[];
        articles: { title: string; url: string; published_at: string | null; fetched_at: string; sources: SourceJoin };
      }[];
      const { data: mentions } = await db.from("asset_mentions").select("article_id, asset_id, sentences").in("article_id", [...new Set(rows.map((r) => r.article_id))]).in("asset_id", assetIds);
      const sentencesOf = new Map((mentions ?? []).map((m) => [`${m.article_id}|${m.asset_id}`, m.sentences as { id: string; text: string }[]]));
      return rows.map<BriefSignal>((r) => ({
        asset_id: r.asset_id,
        article_id: r.article_id,
        source: sourceName(r.articles.sources),
        title: r.articles.title,
        url: r.articles.url,
        published_at: r.articles.published_at ?? r.articles.fetched_at,
        stance: r.stance,
        strength: r.strength,
        why: r.why,
        // Evidence text is looked up by sentence ID from stored data - never taken from the model.
        evidence: (sentencesOf.get(`${r.article_id}|${r.asset_id}`) ?? []).filter((s) => r.evidence_ids.includes(s.id)).map((s) => s.text),
      }));
    },
    async getArticles(ids) {
      const { data } = await db.from("articles").select("id, title, url, published_at, fetched_at, sources(name)").in("id", ids);
      return (data ?? []).map<ArticleMeta>((a) => ({
        id: a.id as string,
        title: a.title as string,
        url: a.url as string,
        published_at: (a.published_at ?? a.fetched_at) as string,
        source: sourceName(a.sources as SourceJoin),
      }));
    },
    async save(row) {
      const { error } = await db.from("briefs").upsert(row, { onConflict: "user_id,day,level,watchlist_hash", ignoreDuplicates: true });
      if (error) console.error(`[brief] save failed: ${error.code ?? "unknown"}`);
    },
  };
}
