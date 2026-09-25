import { describe, expect, it } from "vitest";
import { DETECTION_CONFIG as C } from "@/config/detection";
import { botShare, clickSpike, geoMismatch, ipBurst, noConversions, windowBucket } from "@/lib/detection/rules";
import { AlertDeduper, detect, evaluate } from "@/lib/detection/engine";
import { computeStatsInMemory } from "@/lib/detection/stats-memory";
import type { DetectionEvent } from "@/lib/detection/types";
import { makeStats } from "./fixtures/helpers";

describe("rules on normal traffic", () => {
  it("nothing fires on a healthy link", () => {
    expect(detect([makeStats()])).toEqual([]);
  });
});

describe("IP_BURST", () => {
  it("fires at the threshold with evidence", () => {
    const r = ipBurst(makeStats({ last10m: { clicks: 41, top_ip_clicks: 34 } }), C);
    expect(r.fired).toBe(true);
    expect(r.severity).toBe("high");
    expect(r.evidence).toEqual({ clicks_from_top_ip: 34, total_clicks_in_window: 41, window_minutes: 10 });
  });
  it("does not fire just below the threshold", () => {
    expect(ipBurst(makeStats({ last10m: { clicks: 25, top_ip_clicks: 19 } }), C).fired).toBe(false);
  });
});

describe("BOT_SHARE", () => {
  const w = (clicks: number, bot: number, unknown = 0) =>
    makeStats({ last60m: { ...makeStats().last60m, clicks, bot_clicks: bot, unknown_bot_clicks: unknown } });
  it("medium above 30%, high above 60%", () => {
    expect(botShare(w(40, 16), C)).toMatchObject({ fired: true, severity: "medium" });
    expect(botShare(w(40, 30), C)).toMatchObject({ fired: true, severity: "high" });
    expect(botShare(w(40, 30), C).evidence.bot_share).toBe(0.75);
  });
  it("respects the minimum volume guard", () => {
    expect(botShare(w(19, 19), C).fired).toBe(false);
  });
  it("skips when the bot signal is unknown for most clicks", () => {
    const r = botShare(w(100, 0, 80), C);
    expect(r.fired).toBe(false);
    expect(r.skipped_reason).toBeDefined();
  });
});

describe("NO_CONVERSIONS", () => {
  it("fires with volume, zero signups and a converting baseline", () => {
    const r = noConversions(makeStats({ last24h: { clicks: 250, signups: 0 } }), C);
    expect(r).toMatchObject({ fired: true, severity: "medium" });
    expect(r.evidence).toEqual({ clicks_24h: 250, signups_24h: 0, baseline_signup_rate: 0.05 });
  });
  it("needs 200 clicks and a baseline >= 1%", () => {
    expect(noConversions(makeStats({ last24h: { clicks: 199, signups: 0 } }), C).fired).toBe(false);
    expect(noConversions(makeStats({ last24h: { clicks: 500, signups: 0 }, baseline7d_signup_rate: 0.005 }), C).fired).toBe(false);
  });
  it("skips without a baseline", () => {
    const r = noConversions(makeStats({ last24h: { clicks: 500, signups: 0 }, baseline7d_signup_rate: null }), C);
    expect(r.fired).toBe(false);
    expect(r.skipped_reason).toBeDefined();
  });
});

describe("GEO_MISMATCH", () => {
  const w = (clicks: number, off: number, unknown = 0) =>
    makeStats({ last60m: { ...makeStats().last60m, clicks, off_target_clicks: off, unknown_country_clicks: unknown } });
  it("fires above 40% off-target with >= 30 clicks", () => {
    const r = geoMismatch(w(50, 25), C);
    expect(r.fired).toBe(true);
    expect(r.evidence.off_target_share).toBe(0.5);
  });
  it("guards on volume and share", () => {
    expect(geoMismatch(w(29, 29), C).fired).toBe(false);
    expect(geoMismatch(w(50, 20), C).fired).toBe(false);
  });
  it("skips when country is unknown for most clicks", () => {
    expect(geoMismatch(w(100, 0, 90), C).skipped_reason).toBeDefined();
  });
});

describe("CLICK_SPIKE", () => {
  it("fires on a large z-score with enough volume", () => {
    const r = clickSpike(makeStats({ current_hour_clicks: 200 }), C);
    expect(r.fired).toBe(true);
    expect(r.evidence.history_points).toBe(168);
    expect(Number(r.evidence.z_score)).toBeGreaterThanOrEqual(4);
  });
  it("needs at least 50 clicks even when z is huge", () => {
    const hist = Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : 2));
    expect(clickSpike(makeStats({ hourly_history: hist, current_hour_clicks: 40 }), C).fired).toBe(false);
  });
  it("skips with fewer than 48 history points", () => {
    const r = clickSpike(makeStats({ hourly_history: Array(47).fill(10), current_hour_clicks: 500 }), C);
    expect(r.fired).toBe(false);
    expect(r.skipped_reason).toMatch(/history/);
  });
  it("uses a MAD-based robust z when std = 0 ... and skips when MAD = 0 too", () => {
    const flat = Array(100).fill(20);
    const r = clickSpike(makeStats({ hourly_history: flat, current_hour_clicks: 500 }), C);
    expect(r.fired).toBe(false);
    expect(r.skipped_reason).toMatch(/flat/);
  });
});

describe("engine dedupe", () => {
  it("one alert per (link, rule, window bucket) across repeated cron runs", () => {
    const dd = new AlertDeduper();
    const burst = { last10m: { clicks: 40, top_ip_clicks: 30 } };
    const t1 = dd.filterNew(detect([makeStats({ ...burst, as_of: new Date("2026-09-01T12:01:00Z") })]));
    const t2 = dd.filterNew(detect([makeStats({ ...burst, as_of: new Date("2026-09-01T12:06:00Z") })]));
    const t3 = dd.filterNew(detect([makeStats({ ...burst, as_of: new Date("2026-09-01T12:11:00Z") })]));
    expect(t1).toHaveLength(1);
    expect(t2).toHaveLength(0); // same 10-minute bucket
    expect(t3).toHaveLength(1); // next bucket
  });
  it("windowBucket floors to the rule window", () => {
    expect(windowBucket(new Date("2026-09-01T12:37:10Z"), 60).toISOString()).toBe("2026-09-01T12:00:00.000Z");
  });
  it("evaluate counts skips per rule", () => {
    const out = evaluate([makeStats({ baseline7d_signup_rate: null, hourly_history: [] })]);
    expect(out.skippedByRule).toMatchObject({ NO_CONVERSIONS: 1, CLICK_SPIKE: 1 });
  });
});

describe("in-memory stats", () => {
  const link = { id: "L1", target_countries: ["NG"] };
  const asOf = new Date("2026-09-10T12:00:00Z");
  const ev = (minAgo: number, over: Partial<DetectionEvent> = {}): DetectionEvent => ({
    link_id: "L1",
    at: new Date(asOf.getTime() - minAgo * 60_000),
    ip_hash: "ip-a",
    country_code: "NG",
    is_bot: false,
    converted_signup: false,
    converted_ftd: false,
    ...over,
  });

  it("computes windows with (as_of - w, as_of] semantics", () => {
    const events = [
      ev(0),
      ev(9.99),
      ev(10), // exactly 10 min old -> outside last10m
      ev(30, { is_bot: true, country_code: "US" }),
      ev(59, { is_bot: null, country_code: null }),
      ev(60), // outside last60m
      ev(60 * 23, { converted_signup: true }),
      ev(60 * 30, { converted_signup: true }),
      ev(-5), // in the future: invisible
    ];
    const [s] = computeStatsInMemory(events, [link], asOf);
    expect(s!.last10m).toEqual({ clicks: 2, top_ip_clicks: 2 });
    expect(s!.last60m).toMatchObject({ clicks: 5, bot_clicks: 1, unknown_bot_clicks: 1, off_target_clicks: 1, unknown_country_clicks: 1 });
    expect(s!.last60m.top_off_target_countries).toEqual([{ country_code: "US", clicks: 1 }]);
    expect(s!.last24h).toEqual({ clicks: 7, signups: 1 });
    expect(s!.baseline7d_signup_rate).toBeNull(); // only 1 baseline click (< 100)
    expect(s!.current_hour_clicks).toBe(5);
    expect(s!.hourly_history.length).toBeGreaterThan(0);
  });
});
