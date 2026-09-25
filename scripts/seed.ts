/**
 * npm run seed                  -> upserts the asset catalogue, aliases and verified sources (service role)
 * npm run seed -- --write-sql   -> regenerates supabase/migrations/003_seed_assets.sql from the same config
 * Idempotent: safe to run any number of times.
 */
import { writeFileSync } from "node:fs";
import { ASSETS } from "@/config/assets-seed";
import { renderSeedSql } from "@/config/seed-sql";
import { SOURCES } from "@/config/sources-seed";
import { adminClient, parseArgs } from "./lib/env";

async function main() {
  const args = parseArgs();
  if (args["write-sql"]) {
    writeFileSync("supabase/migrations/003_seed_assets.sql", renderSeedSql());
    console.log("Wrote supabase/migrations/003_seed_assets.sql");
    return;
  }
  const db = adminClient();

  const { data: assets, error } = await db
    .from("assets")
    .upsert(ASSETS.map((a) => ({ slug: a.slug, name: a.name, asset_type: a.asset_type, description_simple: a.description_simple })), { onConflict: "slug" })
    .select("id, slug");
  if (error || !assets) throw new Error(`assets upsert failed: ${error?.message}`);
  const idBySlug = new Map(assets.map((a) => [a.slug as string, a.id as string]));

  const aliasRows = ASSETS.flatMap((a) => a.aliases.map((al) => ({ asset_id: idBySlug.get(a.slug)!, alias: al.alias, is_case_sensitive: Boolean(al.cs) })));
  const { error: aliasErr } = await db.from("asset_aliases").upsert(aliasRows, { onConflict: "asset_id,alias" });
  if (aliasErr) throw new Error(`aliases upsert failed: ${aliasErr.message}`);

  const { error: srcErr } = await db.from("sources").upsert(SOURCES, { onConflict: "feed_url" });
  if (srcErr) throw new Error(`sources upsert failed: ${srcErr.message}`);

  console.log(`Seeded ${assets.length} assets, ${aliasRows.length} aliases, ${SOURCES.length} sources.`);
}

main().catch((e) => {
  console.error(`Seed failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
