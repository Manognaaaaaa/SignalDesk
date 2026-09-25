import { ASSETS, type AssetSeed } from "./assets-seed";
import { SOURCES, type SourceSeed } from "./sources-seed";

/**
 * Renders supabase/migrations/003_seed_assets.sql from the TypeScript catalogue so the SQL seed
 * and `npm run seed` can never drift apart (tests/seed-sync.test.ts compares them).
 * Idempotent: upserts by slug / (asset_id, alias) / feed_url.
 */

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function renderSeedSql(assets: AssetSeed[] = ASSETS, sources: SourceSeed[] = SOURCES): string {
  const lines: string[] = [
    "-- SignalDesk 003: seed the asset catalogue, aliases and verified sources.",
    "-- GENERATED from src/config/assets-seed.ts and sources-seed.ts by `npm run seed -- --write-sql`. Do not edit by hand.",
    "",
    "insert into public.assets (slug, name, asset_type, description_simple) values",
    assets.map((a) => `  (${q(a.slug)}, ${q(a.name)}, ${q(a.asset_type)}, ${q(a.description_simple)})`).join(",\n"),
    "on conflict (slug) do update set name = excluded.name, asset_type = excluded.asset_type, description_simple = excluded.description_simple;",
    "",
    "insert into public.asset_aliases (asset_id, alias, is_case_sensitive)",
    "select a.id, v.alias, v.cs from (values",
    assets.flatMap((a) => a.aliases.map((al) => `  (${q(a.slug)}, ${q(al.alias)}, ${al.cs ? "true" : "false"})`)).join(",\n"),
    ") as v(slug, alias, cs)",
    "join public.assets a on a.slug = v.slug",
    "on conflict (asset_id, alias) do update set is_case_sensitive = excluded.is_case_sensitive;",
    "",
    "insert into public.sources (name, feed_url, site_domain, kind) values",
    sources.map((s) => `  (${q(s.name)}, ${q(s.feed_url)}, ${q(s.site_domain)}, ${q(s.kind)})`).join(",\n"),
    "on conflict (feed_url) do update set name = excluded.name, site_domain = excluded.site_domain, kind = excluded.kind;",
    "",
  ];
  return lines.join("\n");
}
