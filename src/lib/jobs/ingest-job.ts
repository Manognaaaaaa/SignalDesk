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
 *  2. normalise NEW articles (deduped by canonical-URL hash),
 *  3. group them into stories (title shingles, 48 h window) and store them with their story,
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
export type StoredArticle = { id: string; title: string; excerpt: string; story_id?: string | null };
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
  if (fresh.length === 0) return stats;

  // ---- 3. stories, assigned BEFORE insert ----
  // Articles get their id here, so each one is inserted with its story_id already set: a few
  // batched round trips instead of one UPDATE per story (which, from a function far from the
  // database, took minutes on the first run with 24 feeds and hit the 60 s limit).
  const at = (a: { published_at: string | null; fetched_at: string }) => Date.parse(a.published_at ?? a.fetched_at);
  const nowIso = now.toISOString();
  const planned = fresh.map((c) => ({ id: randomUUID() as string, c }));
  const since = new Date(now.getTime() - STORY_WINDOW_MS - 24 * 3_600_000).toISOString();
  const { data: recent } = await db.from("articles").select("story_id, title, published_at, fetched_at").not("story_id", "is", null).gte("fetched_at", since).limit(3000);
  const assignments = assignStories(
    planned.map((p) => ({ article_id: p.id, title: p.c.article.title, at: at({ published_at: p.c.article.published_at, fetched_at: nowIso }) })),
    (recent ?? []).map((r) => ({ story_id: r.story_id as string, title: r.title as string, at: at(r as { published_at: string | null; fetched_at: string }) })),
    randomUUID,
  );
  const storyOf = new Map(assignments.map((x) => [x.article_id, x.story_id]));
  const plannedById = new Map(planned.map((p) => [p.id, p]));
  const newStories = assignments.filter((x) => x.is_new_story);
  if (newStories.length) {
    const rows = newStories.map((x) => {
      const p = plannedById.get(x.article_id)!;
      const t = new Date(at({ published_at: p.c.article.published_at, fetched_at: nowIso })).toISOString();
      return { id: x.story_id, headline: p.c.article.title, first_seen_at: t, last_seen_at: t, article_count: 1, source_count: 1 };
    });
    for (const part of chunk(rows, 200)) {
      const { error } = await db.from("stories").insert(part);
      if (error) console.error(`[ingest] story insert failed: ${error.code ?? "unknown"}`);
    }
  }

  // ---- 2. store new articles with their story ----
  const inserted: StoredArticle[] = [];
  for (const part of chunk(planned, 200)) {
    const { data, error } = await db
      .from("articles")
      .upsert(
        part.map((p) => ({ id: p.id, ...p.c.article, source_id: p.c.source_id, fetched_at: nowIso, story_id: storyOf.get(p.id) ?? null })),
        { onConflict: "url_hash", ignoreDuplicates: true },
      )
      .select("id, title, excerpt, story_id");
    if (error) {
      console.error(`[ingest] article insert failed: ${error.code ?? "unknown"}`);
      continue;
    }
    inserted.push(...((data ?? []) as StoredArticle[]));
  }
  stats.articles_new = inserted.length;
  const insertedStories = new Set(inserted.map((a) => a.story_id).filter((x): x is string => Boolean(x)));
  stats.stories_new = newStories.filter((x) => insertedStories.has(x.story_id)).length;
  stats.stories_joined = inserted.length - stats.stories_new;
  if (insertedStories.size) await db.rpc("refresh_stories", { p_ids: [...insertedStories] });

  // ---- 4. asset mentions ----
  stats.mentions_new = await matchAndStoreMentions(db, inserted);
  return stats;
}

/**
 * Detects assets in stored articles and saves the relevant sentences. Idempotent (existing
 * (article, asset) pairs are kept), so it also serves `npm run rematch`: re-matching recent
 * articles after aliases or assets are added, or after a run died before this step.
 */
export async function matchAndStoreMentions(db: SupabaseClient, articles: StoredArticle[]): Promise<number> {
  if (articles.length === 0) return 0;
  const { data: assets, error: aErr } = await db.from("assets").select("id, asset_aliases(alias, is_case_sensitive)");
  if (aErr) throw new Error(`assets read failed: ${aErr.code ?? "unknown"}`);
  const matcher = compileMatcher(((assets ?? []) as { id: string; asset_aliases: AssetWithAliases["aliases"] }[]).map((a) => ({ id: a.id, aliases: a.asset_aliases ?? [] })));
  const mentionRows = articles.flatMap((a) => matchAssets(buildSentences(a.title, a.excerpt), matcher).map((m) => ({ article_id: a.id, asset_id: m.asset_id, sentences: m.sentences })));
  let saved = 0;
  for (const part of chunk(mentionRows, 300)) {
    const { data, error } = await db.from("asset_mentions").upsert(part, { onConflict: "article_id,asset_id", ignoreDuplicates: true }).select("article_id");
    if (error) console.error(`[ingest] mention insert failed: ${error.code ?? "unknown"}`);
    else saved += data?.length ?? 0;
  }
  return saved;
}
