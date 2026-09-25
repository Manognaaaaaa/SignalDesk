import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSETS } from "@/config/assets-seed";
import { renderSeedSql } from "@/config/seed-sql";
import { SOURCES } from "@/config/sources-seed";

describe("catalogue", () => {
  it("003_seed_assets.sql is generated from the TypeScript catalogue (run `npm run seed -- --write-sql`)", () => {
    expect(readFileSync("supabase/migrations/003_seed_assets.sql", "utf8")).toBe(renderSeedSql());
  });
  it("slugs, aliases and feeds are valid", () => {
    expect(ASSETS.length).toBeGreaterThanOrEqual(15);
    for (const a of ASSETS) {
      expect(a.slug).toMatch(/^[a-z0-9-]{2,30}$/);
      expect(a.aliases.length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(ASSETS.map((a) => a.slug)).size).toBe(ASSETS.length);
    for (const s of SOURCES) expect(s.feed_url.startsWith("https://")).toBe(true);
  });
});
