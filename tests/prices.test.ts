import { describe, expect, it } from "vitest";
import { buildChartRows, lastNDays, priceChange } from "@/lib/chart";
import { pickStale } from "@/lib/jobs/price-job";
import { candleDay, fetchDailyCandles, toCandle, type SocketLike } from "@/lib/prices/deriv";
import type { MoodPoint, TimelineSignal } from "@/lib/ui-types";

const TODAY = new Date("2026-09-28T15:00:00Z");
const sig = (day: string, stance: string): TimelineSignal => ({ article_id: `${day}-${stance}-${Math.random()}`, day, at: `${day}T10:00:00Z`, stance, strength: 2, title: "t", source: "s" });
const mood = (day: string, score: number | null): MoodPoint => ({ day, score, confidence: score === null ? null : "low", source_count: 1, article_count: 1 });

describe("chart rows", () => {
  it("one row per calendar day, oldest first, ending today (UTC)", () => {
    expect(lastNDays(3, TODAY)).toEqual(["2026-09-26", "2026-09-27", "2026-09-28"]);
  });

  it("merges closes, mood and signals; closed-market days keep close null", () => {
    const rows = buildChartRows(
      [
        { day: "2026-09-25", close: 100 },
        { day: "2026-09-28", close: 110 },
      ],
      [mood("2026-09-27", -0.5), mood("2026-09-28", null)],
      [sig("2026-09-27", "bearish"), sig("2026-09-27", "bearish"), sig("2026-09-27", "bullish"), sig("2026-09-28", "neutral")],
      4,
      TODAY,
    );
    expect(rows.map((r) => r.day)).toEqual(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);
    expect(rows.map((r) => r.close)).toEqual([100, null, null, 110]);
    expect(rows[2]).toMatchObject({ mood: -0.5, signals: 3, net: -1 });
    expect(rows[3]).toMatchObject({ mood: null, signals: 1, net: 0 });
    expect(rows[1]).toMatchObject({ signals: 0, net: 0, mood: null });
  });

  it("hawkish/dovish count as up/down for the day's direction", () => {
    const rows = buildChartRows([], [], [sig("2026-09-28", "hawkish"), sig("2026-09-28", "hawkish"), sig("2026-09-28", "dovish")], 1, TODAY);
    expect(rows[0]!.net).toBe(1);
  });

  it("price change uses the first and last known close", () => {
    const rows = buildChartRows([{ day: "2026-09-26", close: 200 }, { day: "2026-09-28", close: 210 }], [], [], 3, TODAY);
    expect(priceChange(rows)).toBeCloseTo(5);
    expect(priceChange(buildChartRows([], [], [], 3, TODAY))).toBeNull();
  });
});

describe("pickStale", () => {
  const t = (slug: string, last_day: string | null) => ({ asset_id: slug, slug, symbol: slug.toUpperCase(), last_day });
  it("never-fetched first, then oldest, skipping symbols already current", () => {
    const picked = pickStale([t("gold", "2026-09-27"), t("btc", "2026-09-28"), t("eur", null), t("spx", "2026-09-20")], "2026-09-28", 2);
    expect(picked.map((p) => p.slug)).toEqual(["eur", "spx"]);
  });
});

describe("Deriv candles", () => {
  it("validates candles and maps epochs to UTC days", () => {
    expect(toCandle({ epoch: 1790553600, open: 1, high: 2, low: 0.5, close: 1.5 })).not.toBeNull();
    expect(toCandle({ epoch: 1, open: 1, high: 1, low: 2, close: 1 })).toBeNull(); // high < low
    expect(toCandle({ epoch: 1, open: 1, high: 1, low: 1, close: 0 })).toBeNull();
    expect(toCandle({ epoch: "x" })).toBeNull();
    expect(candleDay({ epoch: 1790553600, open: 1, high: 1, low: 1, close: 1 })).toBe("2026-09-28");
  });

  /** A fake socket that answers each request from a script of replies. */
  function fakeSocket(replies: (Record<string, unknown> | "silent")[]) {
    const sent: Record<string, unknown>[] = [];
    const sock: SocketLike = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data) {
        sent.push(JSON.parse(data));
        const r = replies.shift();
        if (r && r !== "silent") queueMicrotask(() => sock.onmessage?.({ data: JSON.stringify(r) }));
      },
      close() {},
    };
    queueMicrotask(() => sock.onopen?.({}));
    return { sock, sent };
  }

  it("requests symbols one at a time with a gap, retries once on RateLimit, isolates errors", async () => {
    const candle = { epoch: 1790553600, open: 1, high: 2, low: 0.5, close: 1.5 };
    const { sock, sent } = fakeSocket([{ candles: [candle] }, { error: { code: "RateLimit" } }, { candles: [candle, candle] }, { error: { code: "InvalidSymbol" } }]);
    const sleeps: number[] = [];
    const out = await fetchDailyCandles(["A", "B", "C"], 5, { connect: () => sock, sleep: async (ms) => void sleeps.push(ms), url: "wss://x", gapMs: 3200 });
    expect(out).toEqual([
      { symbol: "A", ok: true, candles: [candle] },
      { symbol: "B", ok: true, candles: [candle, candle] },
      { symbol: "C", ok: false, error: "InvalidSymbol" },
    ]);
    expect(sent.map((s) => s.ticks_history)).toEqual(["A", "B", "B", "C"]);
    expect(sent[0]).toMatchObject({ style: "candles", granularity: 86400, count: 5, end: "latest" });
    expect(sleeps).toEqual([3200, 15000, 3200]);
  });

  it("a socket that never opens fails every symbol instead of throwing", async () => {
    const sock: SocketLike = { onopen: null, onmessage: null, onerror: null, onclose: null, send() {}, close() {} };
    queueMicrotask(() => sock.onerror?.({}));
    const out = await fetchDailyCandles(["A", "B"], 5, { connect: () => sock, sleep: async () => undefined, url: "wss://x", gapMs: 0 });
    expect(out.every((r) => !r.ok && r.error === "connect_failed")).toBe(true);
  });
});
