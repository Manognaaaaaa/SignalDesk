import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchFeed, mapWithConcurrency, parseFeed } from "@/lib/ingest/feeds";
import { canonicalUrl, normaliseItem, stripHtml, urlHash } from "@/lib/ingest/normalise";
import type { SafeFetchDeps } from "@/lib/ingest/safe-fetch";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const rss = readFileSync("tests/fixtures/sample-rss.xml", "utf8");
const atom = readFileSync("tests/fixtures/sample-atom.xml", "utf8");

describe("normalise", () => {
  it("strips HTML, scripts and entities", () => {
    expect(stripHtml("<p>Gold &amp; <b>silver</b></p><script>alert(1)</script>")).toBe("Gold & silver");
    expect(stripHtml("&lt;b&gt;literal&lt;/b&gt; &#8217;x&#x2019;")).toBe("literal ’x’");
    expect(stripHtml(null)).toBe("");
  });

  it("canonicalises URLs: drops utm_* and fragments, keeps other params", () => {
    expect(canonicalUrl("https://News.Example.com/a?utm_source=x&id=1&utm_medium=y#frag")).toBe("https://news.example.com/a?id=1");
    expect(canonicalUrl("https://x.com/a?fbclid=1")).toBe("https://x.com/a");
    expect(urlHash("https://x.com/a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects non-http(s) links", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ftp://x.com/a", "/relative", "", "https://u:p@x.com/"]) expect(canonicalUrl(bad), bad).toBeNull();
  });

  it("drops items older than 7 days, without titles or with bad links; clamps future dates", () => {
    expect(normaliseItem({ title: "t", link: "https://x.com/a", date: "2026-09-10T00:00:00Z" }, NOW)).toEqual({ ok: false, reason: "too_old" });
    expect(normaliseItem({ title: "<br>", link: "https://x.com/a" }, NOW)).toEqual({ ok: false, reason: "no_title" });
    expect(normaliseItem({ title: "t", link: "javascript:x" }, NOW)).toEqual({ ok: false, reason: "bad_url" });
    const future = normaliseItem({ title: "t", link: "https://x.com/f", date: "2027-01-01T00:00:00Z" }, NOW);
    expect(future.ok && future.article.published_at).toBe(new Date(NOW).toISOString());
    const noDate = normaliseItem({ title: "t", link: "https://x.com/n" }, NOW);
    expect(noDate.ok && noDate.article.published_at).toBeNull();
  });

  it("caps the excerpt at 500 characters", () => {
    const r = normaliseItem({ title: "t", link: "https://x.com/e", summary: "word ".repeat(300) }, NOW);
    expect(r.ok && r.article.excerpt.length).toBeLessThanOrEqual(500);
  });
});

describe("feeds", () => {
  it("parses RSS and Atom into raw items", async () => {
    const items = await parseFeed(rss);
    expect(items).toHaveLength(4);
    expect(items[0]!.link).toContain("gold-record");
    const a = await parseFeed(atom);
    expect(a[0]!.title).toBe("ECB keeps rates unchanged");
    expect(a[0]!.link).toBe("https://cb.example.org/press/2026/ecb-decision");
  });

  it("end-to-end fixture: 2 valid articles, old and javascript: items dropped", async () => {
    const out = (await parseFeed(rss)).map((i) => normaliseItem(i, NOW));
    expect(out.filter((r) => r.ok)).toHaveLength(2);
    const first = out[0]!;
    expect(first.ok && first.article.title).toBe("Gold climbs to record as investors seek safety");
    expect(first.ok && first.article.url).toBe("https://news.example.com/markets/gold-record?id=42");
  });

  it("sends conditional headers and a User-Agent; maps 304 and errors without throwing", async () => {
    const seen: Record<string, string>[] = [];
    const mk = (status: number, body = rss): SafeFetchDeps => ({
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async (_u, _a, o) => {
        seen.push(o.headers);
        return { status, headers: { etag: '"v2"' }, body: Buffer.from(body) };
      },
    });
    const src = { id: "s", feed_url: "https://feeds.example.com/rss", etag: '"v1"', last_modified: "Mon, 21 Sep 2026 10:00:00 GMT" };
    const r = await fetchFeed(src, "https://signaldesk.example.app", mk(200));
    expect(r.status === "ok" && r.etag).toBe('"v2"');
    expect(seen[0]!["If-None-Match"]).toBe('"v1"');
    expect(seen[0]!["If-Modified-Since"]).toBe(src.last_modified);
    expect(seen[0]!["User-Agent"]).toContain("https://signaldesk.example.app");
    expect((await fetchFeed(src, "x", mk(304))).status).toBe("not_modified");
    expect(await fetchFeed(src, "x", mk(500))).toEqual({ status: "error", error: "http_500" });
    expect(await fetchFeed(src, "x", mk(200, "<html>not a feed"))).toEqual({ status: "error", error: "parse_error" });
    expect(await fetchFeed({ ...src, feed_url: "http://feeds.example.com/rss" }, "x", mk(200))).toEqual({ status: "error", error: "bad_url" });
  });

  it("limits concurrency", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });
});
