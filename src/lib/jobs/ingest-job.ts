import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compileMatcher, matchAssets, type AssetWithAliases } from "@/lib/ingest/asset-matcher";
import { fetchFeed, mapWithConcurrency, type FeedSource } from "@/lib/ingest/feeds";
import { normaliseItem, type NormalisedArticle } from "@/lib/ingest/normalise";
import { defaultDeps, type SafeFetchDeps } from "@/lib/ingest/safe-fetch";
import { buildSentences } from "@/lib/ingest/sentences";
import { assignStories, STORY_WINDOW_MS } from "@/lib/ingest/stories";

/**
 * Ingest steps 1-4 (all deterministic, no LLM, works without GROQ_API_KEY):
 *  1. fetch active feeds (concurrency 8, so ~24 feeds with 10 s timeouts fit the 60 s function limit; conditional requests, failures counted per source),
 *  2. normalise and store NEW articles (deduped by canonical-URL hash),
 *  3. group new articles into stories (title shingles, 48 h window),
 *  4. detect assets per new article and store the relevant sentences.
 * Idempotent: re-running inserts nothing new for already-seen URLs.
 */

export const MAX_CONSECUTIVE_FAILURES = 5;
export const FETCH_CONCURRENCY = 8;

export type IngestStats = {
  sources: number;
  fetched_ok: number;
  not_modified: number;
  failed: number;
  deactivated: string[];
  items_seen: number;
  skipped: Record<string, number>;
  articles_new: number;
  stories_new: number;
  stories_joined: number;
  mentions_new: number;
};

type SourceRow = FeedSource & { name: string; consecutive_failures: number };
type Candidate = { source_id: string; article: NormalisedArticle };

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function runIngestSteps(db: SupabaseClient, opts: { appBaseUrl: string; now?: Date; fetchDeps?: SafeFetchDeps }): Promise<IngestStats> {
  const now = opts.now ?? new Date();
  const stats: IngestStats = { sources: 0, fetched_ok: 0, not_modified: 0, failed: 0, deactivated: [], items_seen: 0, skipped: {}, articles_new: 0, stories_new: 0, stories_joined: 0, mentions_new: 0 };

  // ---- 1. fetch feeds (only URLs from the sources table) ----
  const { data: srcData, error: srcErr } = await db.from("sources").select("id, name, feed_url, etag, last_modified, consecutive_failures").eq("is_active", true);
  if (srcErr) throw new Error(`sources read failed: ${srcErr.code ?? "unknown"}`);
  const sources = (srcData ?? []) as SourceRow[];
  stats.sources = sources.length;

  const candidates: Candidate[] = [];
  await mapWithConcurrency(sources, FETCH_CONCURRENCY, async (src) => {
    const res = await fetchFeed(src, opts.appBaseUrl, opts.fetchDeps ?? defaultDeps);
    const base = { last_fetched_at: now.toISOString() };
    if (res.status === "error") {
      stats.failed++;
      const failures = src.consecutive_failures + 1;
      const deactivate = failures >= MAX_CONSECUTIVE_FAILURES;
      if (deactivate) {
        stats.deactivated.push(src.name);
        console.warn(`[ingest] deactivating source after ${failures} consecutive failures: ${src.name}`);
      }
      await db.from("sources").update({ ...base, last_status: res.error, consecutive_failures: failures, ...(deactivate ? { is_active: false } : {}) }).eq("id", src.id);
      return;
    }
    if (res.status === "not_modified") {
      stats.not_modified++;
      await db.from("sources").update({ ...base, last_status: "304", consecutive_failures: 0 }).eq("id", src.id);
      return;
    }
    stats.fetched_ok++;
    await db.from("sources").update({ ...base, last_status: String(res.http), consecutive_failures: 0, etag: res.etag, last_modified: res.last_modified }).eq("id", src.id);
    for (const item of res.items) {
      stats.items_seen++;
      const n = normaliseItem(item, now.getTime());
      if (!n.ok) stats.skipped[n.reason] = (stats.skipped[n.reason] ?? 0) + 1;
      else candidates.push({ source_id: src.id, article: n.article });
    }
  });

  // ---- 2. store new articles (dedupe in batch and against the DB) ----
  const unique = new Map<string, Candidate>();
  for (const c of candidates) if (!unique.has(c.article.url_hash)) unique.set(c.article.url_hash, c);
  const existing = new Set<string>();
  for (const part of chunk([...unique.keys()], 200)) {
    const { data } = await db.from("articles").select("url_hash").in("url_hash", part);
    for (const r of data ?? []) existing.add(r.url_hash as string);
  }
  const fresh = [...unique.values()].filter((c) => !existing.has(c.article.url_hash));
  type Inserted = { id: string; source_id: string; title: string; excerpt: string; published_at: string | null; fetched_at: string };
  const inserted: Inserted[] = [];
  for (const part of chunk(fresh, 200)) {
    const { data, error } = await db
      .from("articles")
      .upsert(part.map((c) => ({ ...c.article, source_id: c.source_id, fetched_at: now.toISOString() })), { onConflict: "url_hash", ignoreDuplicates: true })
      .select("id, source_id, title, excerpt, published_at, fetched_at");
    if (error) {
      console.error(`[ingest] article insert failed: ${error.code ?? "unknown"}`);
      continue;
    }
    inserted.push(...((data ?? []) as Inserted[]));
  }
  stats.articles_new = inserted.length;
  if (inserted.length === 0) return stats;

  // ---- 3. stories ----
  const at = (a: { published_at: string | null; fetched_at: string }) => Date.parse(a.published_at ?? a.fetched_at);
  const since = new Date(now.getTime() - STORY_WINDOW_MS - 24 * 3_600_000).toISOString();
  const { data: recent } = await db.from("articles").select("story_id, title, published_at, fetched_at").not("story_id", "is", null).gte("fetched_at", since).limit(3000);
  const assignments = assignStories(
    inserted.map((a) => ({ article_id: a.id, title: a.title, at: at(a) })),
    (recent ?? []).map((r) => ({ story_id: r.story_id as string, title: r.title as string, at: at(r as { published_at: string | null; fetched_at: string }) })),
    randomUUID,
  );
  const byId = new Map(inserted.map((a) => [a.id, a]));
  const newStories = assignments.filter((a) => a.is_new_story);
  stats.stories_new = newStories.length;
  stats.stories_joined = assignments.length - newStories.length;
  if (newStories.length) {
    const rows = newStories.map((s) => {
      const a = byId.get(s.article_id)!;
      const t = new Date(at(a)).toISOString();
      return { id: s.story_id, headline: a.title, first_seen_at: t, last_seen_at: t, article_count: 1, source_count: 1 };
    });
    for (const part of chunk(rows, 200)) {
      const { error } = await db.from("stories").insert(part);
      if (error) console.error(`[ingest] story insert failed: ${error.code ?? "unknown"}`);
    }
  }
  const byStory = new Map<string, string[]>();
  for (const a of assignments) (byStory.get(a.story_id) ?? byStory.set(a.story_id, []).get(a.story_id)!).push(a.article_id);
  for (const [storyId, ids] of byStory) {
    const { error } = await db.from("articles").update({ story_id: storyId }).in("id", ids);
    if (error) console.error(`[ingest] story assignment failed: ${error.code ?? "unknown"}`);
  }
  await db.rpc("refresh_stories", { p_ids: [...byStory.keys()] });

  // ---- 4. asset mentions ----
  const { data: assets, error: aErr } = await db.from("assets").select("id, asset_aliases(alias, is_case_sensitive)");
  if (aErr) throw new Error(`assets read failed: ${aErr.code ?? "unknown"}`);
  const matcher = compileMatcher(((assets ?? []) as { id: string; asset_aliases: AssetWithAliases["aliases"] }[]).map((a) => ({ id: a.id, aliases: a.asset_aliases ?? [] })));
  const mentionRows = inserted.flatMap((a) =>
    matchAssets(buildSentences(a.title, a.excerpt), matcher).map((m) => ({ article_id: a.id, asset_id: m.asset_id, sentences: m.sentences })),
  );
  for (const part of chunk(mentionRows, 300)) {
    const { data, error } = await db.from("asset_mentions").upsert(part, { onConflict: "article_id,asset_id", ignoreDuplicates: true }).select("article_id");
    if (error) console.error(`[ingest] mention insert failed: ${error.code ?? "unknown"}`);
    else stats.mentions_new += data?.length ?? 0;
  }
  return stats;
}
