import { describe, expect, it } from "vitest";
import { computeMood, confidenceFor, recencyWeight, type MoodSignal } from "@/lib/mood/compute";

const NOW = new Date("2026-09-25T12:00:00Z");
let n = 0;
const sig = (over: Partial<MoodSignal>): MoodSignal => ({
  asset_id: "gold",
  article_id: `art-${++n}`,
  source_id: "src-a",
  story_id: `story-${n}`,
  stance: "bullish",
  strength: 3,
  status: "ok",
  at: NOW,
  ...over,
});

describe("daily mood", () => {
  it("known inputs give known score, agreement and confidence", () => {
    const rows = computeMood(
      [sig({ source_id: "a" }), sig({ source_id: "b" }), sig({ source_id: "c", stance: "bearish" })],
      NOW,
    );
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.score).toBeCloseTo(1 / 3, 3); // (+1 +1 -1) / 3, equal weights
    expect(r.agreement).toBeCloseTo(0.667, 3);
    expect(r.source_count).toBe(3);
    expect(r.article_count).toBe(3);
    expect(r.confidence).toBe("medium"); // 3 sources but agreement < 0.7
    expect(r.day).toBe("2026-09-25");
  });

  it("high confidence needs >= 3 sources and agreement >= 0.7", () => {
    const r = computeMood([sig({ source_id: "a" }), sig({ source_id: "b" }), sig({ source_id: "c" })], NOW)[0]!;
    expect(r).toMatchObject({ score: 1, agreement: 1, confidence: "high" });
    expect(confidenceFor(1, 1)).toBe("low");
    expect(confidenceFor(2, 0.1)).toBe("medium");
  });

  it("one vote per story per source (repeated coverage counts once)", () => {
    const rows = computeMood(
      [
        sig({ source_id: "a", story_id: "s1", stance: "bearish", strength: 1 }),
        sig({ source_id: "a", story_id: "s1", stance: "bearish", strength: 3 }),
        sig({ source_id: "a", story_id: "s1", stance: "bearish", strength: 2 }),
        sig({ source_id: "b", story_id: "s1", stance: "bullish", strength: 3 }),
      ],
      NOW,
    );
    expect(rows[0]!.score).toBe(0); // one bearish vote (a) vs one bullish vote (b), equal weight
    expect(rows[0]!.article_count).toBe(2);
  });

  it("excludes unclear and failed signals", () => {
    const rows = computeMood([sig({ stance: "unclear", status: "unclear" }), sig({ status: "failed", stance: "unclear" }), sig({ stance: "dovish" })], NOW);
    expect(rows[0]!).toMatchObject({ score: -1, article_count: 1 });
    expect(computeMood([sig({ stance: "unclear", status: "unclear" })], NOW)).toEqual([]);
  });

  it("weights by strength, recency and per-source volume, clamped to [-1, 1]", () => {
    expect(recencyWeight(new Date(NOW.getTime() - 24 * 3_600_000), NOW.getTime())).toBeCloseTo(0.5);
    // strong fresh bullish vs weak bearish: positive, within bounds
    const r = computeMood([sig({ source_id: "a", strength: 3 }), sig({ source_id: "b", stance: "bearish", strength: 1 })], NOW)[0]!;
    expect(r.score).toBeCloseTo(0.5, 3); // (1*1 - 1/3) / (1 + 1/3)
    for (const row of computeMood([sig({}), sig({ stance: "bearish", source_id: "z" })], NOW)) {
      expect(row.score).toBeGreaterThanOrEqual(-1);
      expect(row.score).toBeLessThanOrEqual(1);
    }
    // a prolific source is down-weighted: 3 bullish from A vs 1 bearish from B -> 0
    const p = computeMood([sig({ source_id: "A" }), sig({ source_id: "A" }), sig({ source_id: "A" }), sig({ source_id: "B", stance: "bearish" })], NOW)[0]!;
    expect(p.score).toBe(0);
  });

  it("strength 0 votes carry no weight; hawkish counts as +1", () => {
    expect(computeMood([sig({ strength: 0 })], NOW)[0]!.score).toBe(0);
    expect(computeMood([sig({ stance: "hawkish" })], NOW)[0]!.score).toBe(1);
  });

  it("separates days and assets", () => {
    const rows = computeMood([sig({}), sig({ at: new Date("2026-09-24T10:00:00Z") }), sig({ asset_id: "fed", stance: "hawkish" })], NOW);
    expect(rows.map((r) => `${r.asset_id}:${r.day}`)).toEqual(["fed:2026-09-25", "gold:2026-09-24", "gold:2026-09-25"]);
  });
});
