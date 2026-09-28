/**
 * npm run rematch [-- --days 7]
 * Re-runs asset detection over articles stored in the last N days and saves any (article, asset)
 * mention not stored yet. Idempotent. Use it after adding assets or aliases (old articles get
 * matched against the new catalogue), or after a run died between storing articles and matching
 * them. New mentions are picked up by the next scoring run.
 */
import { matchAndStoreMentions, type StoredArticle } from "@/lib/jobs/ingest-job";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseArgs } from "./lib/env";

async function main() {
  const args = parseArgs();
  const days = Number(args.days ?? 7);
  if (!(Number.isInteger(days) && days > 0 && days <= 30)) {
    console.error("--days must be an integer between 1 and 30");
    process.exit(1);
  }
  const db = supabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const articles: StoredArticle[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("articles").select("id, title, excerpt").gte("fetched_at", since).order("fetched_at").range(from, from + 999);
    if (error) throw new Error(`articles read failed: ${error.code ?? "unknown"}`);
    articles.push(...((data ?? []) as StoredArticle[]));
    if (!data || data.length < 1000) break;
  }
  const { count: before } = await db.from("asset_mentions").select("*", { count: "exact", head: true });
  const added = await matchAndStoreMentions(db, articles);
  console.log(`${articles.length} articles from the last ${days} days re-matched: ${added} new mentions (${before ?? 0} -> ${(before ?? 0) + added}).`);
}

main().catch((e) => {
  console.error(`rematch failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
