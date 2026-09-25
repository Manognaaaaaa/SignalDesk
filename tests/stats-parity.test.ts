import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { computeStatsInMemory } from "@/lib/detection/stats-memory";
import { computeStatsFromDb } from "@/lib/detection/stats-sql";
import { generateNormal, injectAttack, makeSimLinks } from "@/lib/simulate/generator";
import { mulberry32 } from "@/lib/simulate/prng";
import { buildRows, insertInBatches } from "@/lib/simulate/rows";

/**
 * INTEGRATION: proves the SQL function get_link_window_stats and the in-memory StatsTimeline
 * produce IDENTICAL LinkWindowStats for the same events. This is what makes /evaluation numbers
 * describe production. Skipped unless a real (non-production!) Supabase project is configured:
 *   PARITY_TEST=1 NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx vitest run tests/stats-parity.test.ts
 * It creates one temporary affiliate + link and deletes them afterwards (cascade).
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.PARITY_TEST === "1" && Boolean(url && key);

describe.skipIf(!enabled)("stats parity (SQL vs in-memory)", () => {
  it("identical LinkWindowStats on the same fixture", async () => {
    const db = createClient(url!, key!, { auth: { persistSession: false } });
    const rng = mulberry32(2024);
    const asOf = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 7 * 60_000);
    const aff = await db.from("affiliates").insert({ name: "Parity Test Affiliate", country_code: "NG", tier: "bronze" }).select("id").single();
    expect(aff.error).toBeNull();
    try {
      const slug = `parity-${Date.now().toString(36)}`;
      const link = await db
        .from("links")
        .insert({ slug, affiliate_id: aff.data!.id, campaign_name: "Parity", destination_url: "https://example.com/p", target_countries: ["NG", "KE"], purpose: "campaign" })
        .select("id")
        .single();
      expect(link.error).toBeNull();
      const [sim] = makeSimLinks(1, rng);
      const simLink = { ...sim!, id: link.data!.id, target_countries: ["NG", "KE"] };
      const events = generateNormal([simLink], new Date(asOf.getTime() - 9 * 86_400_000), asOf, rng);
      events.push(...injectAttack("bot_burst", { ip_count: 1, clicks_per_10min: 30, bot_share: 0.8, duration_min: 10 }, { link: simLink, start: new Date(asOf.getTime() - 9 * 60_000) }, rng).events);
      // Conversions must exist by as_of for SQL to count them; buildRows clamps them to `now`.
      const rows = buildRows(events, { dataset: "simulated", now: asOf.getTime(), rng });
      await insertInBatches(db, "click_events", rows.clicks);
      await insertInBatches(db, "conversions", rows.conversions.filter((c) => c.type === "signup"));
      // Compare against in-memory stats computed from the SAME rows (hashed ip labels).
      const memEvents = rows.clicks.map((c, i) => ({ ...events[i]!, ip_hash: c.ip_hash }));
      const sql = (await computeStatsFromDb(db, asOf)).find((s) => s.link_id === link.data!.id);
      const mem = computeStatsInMemory(memEvents, [{ id: link.data!.id, target_countries: ["NG", "KE"] }], asOf)[0];
      expect(sql).toEqual(mem);
    } finally {
      await db.from("affiliates").delete().eq("id", aff.data!.id);
    }
  }, 120_000);
});
