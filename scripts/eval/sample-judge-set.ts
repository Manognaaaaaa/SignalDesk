/**
 * npm run eval:sample [-- --n 200 --seed 42 --hard-share 0.3 --out eval/judge/labels.csv]
 *
 * Samples (numbered sentences, asset) examples from stored asset_mentions into the labelling
 * CSV, stratified across assets and sources with a quota of harder cases (see
 * src/lib/eval/sampling.ts). Model predictions are NOT exported, so they cannot bias labels.
 *
 * Top-up safe: if the CSV exists, its rows (and your labels) are kept untouched and only
 * enough new examples are appended to reach --n in total. Re-running with the same seed and
 * the same database gives the same sample.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { ASSETS, type AssetType } from "@/config/assets-seed";
import { allowedStances } from "@/lib/ai/prompts";
import { parseCsv, toCsv } from "@/lib/eval/csv";
import { formatSentences, JUDGE_COLUMNS } from "@/lib/eval/judge-dataset";
import { stratifiedSample, type Candidate } from "@/lib/eval/sampling";
import { aliasPattern } from "@/lib/ingest/asset-matcher";
import type { Sentence } from "@/lib/ingest/sentences";
import { adminClient, parseArgs } from "../lib/env";

type MentionRow = {
  article_id: string;
  asset_id: string;
  sentences: Sentence[];
  assets: { slug: string; name: string; asset_type: AssetType } | null;
  articles: { url: string; published_at: string | null; fetched_at: string; sources: { name: string } | null } | null;
};

const exampleId = (articleId: string, slug: string) => `${slug}-${createHash("sha1").update(`${articleId}:${slug}`).digest("hex").slice(0, 8)}`;

async function loadMentions(): Promise<MentionRow[]> {
  const db = adminClient();
  const out: MentionRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("asset_mentions")
      .select("article_id, asset_id, sentences, assets(slug, name, asset_type), articles(url, published_at, fetched_at, sources(name))")
      .order("article_id")
      .order("asset_id")
      .range(from, from + 999);
    if (error) throw new Error(`could not read asset_mentions: ${error.message}`);
    out.push(...(data as unknown as MentionRow[]));
    if (!data || data.length < 1000) return out;
  }
}

async function main() {
  const args = parseArgs();
  const n = Number(args.n ?? 200);
  const seed = Number(args.seed ?? 42);
  const hardShare = Number(args["hard-share"] ?? 0.3);
  const outPath = typeof args.out === "string" ? args.out : "eval/judge/labels.csv";
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(seed) || !(hardShare >= 0 && hardShare <= 1)) {
    console.error("Usage: npm run eval:sample -- [--n 200] [--seed 42] [--hard-share 0.3] [--out eval/judge/labels.csv]");
    process.exit(1);
  }

  const existingRows = existsSync(outPath) ? parseCsv(readFileSync(outPath, "utf8")) : [];
  const existingIds = new Set(existingRows.map((r) => r.example_id));

  const patterns = new Map(ASSETS.map((a) => [a.slug, a.aliases.map((x) => aliasPattern({ alias: x.alias, is_case_sensitive: Boolean(x.cs) }))]));
  const mentions = await loadMentions();
  const perArticle = new Map<string, number>();
  for (const m of mentions) perArticle.set(m.article_id, (perArticle.get(m.article_id) ?? 0) + 1);

  const byKey = new Map<string, { m: MentionRow; bucket: string }>();
  const candidates: Candidate[] = [];
  for (const m of mentions) {
    if (!m.assets || !m.articles) continue;
    const key = exampleId(m.article_id, m.assets.slug);
    if (existingIds.has(key)) continue;
    // S1 is always the headline. "Hard" = the asset is only in the body, or the article covers 3+ assets.
    const title = m.sentences.find((s) => s.id === "S1");
    const inTitle = Boolean(title && (patterns.get(m.assets.slug) ?? []).some((p) => p.test(title.text)));
    const multi = (perArticle.get(m.article_id) ?? 0) >= 3;
    const bucket = !inTitle ? "not_in_title" : multi ? "multi_asset" : "standard";
    byKey.set(key, { m, bucket });
    candidates.push({ key, asset: m.assets.slug, source: m.articles.sources?.name ?? "unknown", hard: bucket !== "standard" });
  }

  const want = Math.max(0, n - existingRows.length);
  const existing = existingRows.map((r) => ({ asset: (r.example_id ?? "").replace(/-[0-9a-f]{8}$/, ""), hard: r.bucket !== "standard" }));
  const picked = stratifiedSample(candidates, want, { seed, hardShare, existing });

  const newRows = picked.map((c) => {
    const { m, bucket } = byKey.get(c.key)!;
    return {
      example_id: c.key,
      asset: m.assets!.name,
      article_id: m.article_id,
      numbered_sentences: formatSentences(m.sentences),
      gold_stance: "",
      gold_supporting_sentence_ids: "",
      notes: "",
      asset_type: m.assets!.asset_type,
      allowed_stances: allowedStances(m.assets!.asset_type).join(" / "),
      source: c.source,
      published_at: (m.articles!.published_at ?? m.articles!.fetched_at).slice(0, 10),
      bucket,
      url: m.articles!.url,
    };
  });

  const all = [...existingRows, ...newRows];
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, toCsv(JUDGE_COLUMNS, all));

  const tally = (key: "asset" | "source" | "bucket") =>
    Object.entries(all.reduce<Record<string, number>>((a, r) => ((a[r[key]!] = (a[r[key]!] ?? 0) + 1), a), {}))
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");
  console.log(`${mentions.length} stored mentions, ${candidates.length} not yet in the file.`);
  console.log(`Kept ${existingRows.length} existing rows, added ${newRows.length} (seed ${seed}) -> ${all.length} rows in ${outPath}.`);
  if (all.length < n) console.log(`Only ${all.length} of the requested ${n}: not enough stored mentions yet. Collect more (npm run ingest) and re-run to top up.`);
  console.log(`By asset:  ${tally("asset")}`);
  console.log(`By source: ${tally("source")}`);
  console.log(`By bucket: ${tally("bucket")}`);
}

main().catch((e) => {
  console.error(`sample failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
