import { describe, expect, it } from "vitest";
import { ASSETS } from "@/config/assets-seed";
import { aliasPattern, compileMatcher, escapeRegex, matchAssets } from "@/lib/ingest/asset-matcher";
import { buildSentences, splitSentences } from "@/lib/ingest/sentences";
import { assignStories, jaccard, shingles } from "@/lib/ingest/stories";

const H = 3_600_000;
let n = 0;
const newId = () => `story-${++n}`;

describe("story grouping", () => {
  it("near-identical titles from different outlets join one story", () => {
    const out = assignStories(
      [
        { article_id: "a1", title: "Fed holds interest rates steady, signals two cuts later this year", at: 0 },
        { article_id: "a2", title: "Fed holds interest rates steady and signals two cuts later this year", at: 2 * H },
      ],
      [],
      newId,
    );
    expect(out[0]!.is_new_story).toBe(true);
    expect(out[1]!.story_id).toBe(out[0]!.story_id);
    expect(out[1]!.is_new_story).toBe(false);
  });

  it("different stories stay apart", () => {
    const out = assignStories(
      [
        { article_id: "a1", title: "Gold hits record high as dollar weakens", at: 0 },
        { article_id: "a2", title: "Nvidia shares fall after export restrictions", at: H },
      ],
      [],
      newId,
    );
    expect(out[0]!.story_id).not.toBe(out[1]!.story_id);
  });

  it("respects the 48-hour window and joins existing stories", () => {
    const title = "ECB keeps key interest rates unchanged in September";
    const recent = [{ story_id: "old", title, at: 0 }];
    expect(assignStories([{ article_id: "x", title, at: 47 * H }], recent, newId)[0]!.story_id).toBe("old");
    expect(assignStories([{ article_id: "y", title, at: 49 * H }], recent, newId)[0]!.story_id).not.toBe("old");
  });

  it("jaccard on shingles ignores case, punctuation and stopwords", () => {
    expect(jaccard(shingles("The Fed Holds Rates Steady!"), shingles("fed holds rates steady"))).toBe(1);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe("sentences", () => {
  it("title is S1 and the excerpt follows", () => {
    const s = buildSentences("Gold rises", "Prices rose 1%. Demand is strong! Is it over?");
    expect(s.map((x) => x.id)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(s[0]!.text).toBe("Gold rises");
    expect(splitSentences("One. Two.")).toEqual(["One.", "Two."]);
  });
});

const catalogue = compileMatcher(ASSETS.map((a) => ({ id: a.slug, aliases: a.aliases.map((x) => ({ alias: x.alias, is_case_sensitive: Boolean(x.cs) })) })));
const detect = (title: string, excerpt = "") => matchAssets(buildSentences(title, excerpt), catalogue).map((m) => m.asset_id);

describe("asset matcher", () => {
  it("matches whole words only ('gold' not in 'golden')", () => {
    expect(detect("Golden State Warriors win again")).not.toContain("gold");
    expect(detect("Gold climbs as dollar slips")).toContain("gold");
  });

  it("case-sensitive tickers and names", () => {
    expect(detect("NVDA jumps after earnings")).toContain("nvidia");
    expect(detect("nvda is lowercase noise")).not.toContain("nvidia"); // ticker alias is case-sensitive
    expect(detect("NVIDIA and nvidia both match the name alias")).toContain("nvidia");
    expect(detect("Farmers fed the cattle")).not.toContain("fed");
    expect(detect("Fed's Powell speaks")).toContain("fed");
    expect(detect("an apple a day")).not.toContain("apple");
    expect(detect("Apple unveils new iPhone")).toContain("apple");
  });

  it("multi-word aliases and regex special characters", () => {
    expect(detect("The European  Central Bank held rates")).toContain("ecb");
    expect(detect("S&P 500 closes at record")).toContain("sp-500");
    expect(detect("EUR/USD slips below 1.10")).toContain("eur-usd");
    expect(escapeRegex("S&P (500).*")).toBe("S&P \\(500\\)\\.\\*");
    expect(aliasPattern({ alias: "a.b", is_case_sensitive: false }).test("axb")).toBe(false);
  });

  it("stores mentioning sentences plus one neighbour each side, max 6", () => {
    const excerpt = "Filler one. Filler two. Oil prices fell. Filler four. Filler five. Filler six.";
    const m = matchAssets(buildSentences("Markets wrap", excerpt), catalogue).find((x) => x.asset_id === "oil")!;
    expect(m.sentences.map((s) => s.id)).toEqual(["S3", "S4", "S5"]);
    const many = matchAssets(
      buildSentences("Gold one", "Gold two. Gold three. Gold four. Gold five. Gold six. Gold seven. Gold eight."),
      catalogue,
    ).find((x) => x.asset_id === "gold")!;
    expect(many.sentences).toHaveLength(6);
  });
});
