import { describe, expect, it } from "vitest";
import {
  DESIGNED_ATTACKS,
  HELD_OUT_ATTACKS,
  attackDuration,
  injectAttack,
  makeSimLinks,
  sampleAttackParams,
  type AttackKind,
} from "@/lib/simulate/generator";
import { demoParams } from "@/lib/simulate/live";
import { mulberry32 } from "@/lib/simulate/prng";
import { buildRows } from "@/lib/simulate/rows";

const RANGES: Record<AttackKind, Record<string, [number, number]>> = {
  bot_burst: { ip_count: [1, 3], clicks_per_10min: [15, 80], bot_share: [0.6, 1], duration_min: [10, 40] },
  click_farm: { ip_count: [20, 200], off_target_share: [0.5, 0.95], duration_h: [2, 24], clicks_per_hour: [5, 40] },
  spike: { multiplier: [3, 15], duration_h: [1, 3], bot_share: [0.05, 0.3], off_target_share: [0.05, 0.3] },
  slow_drip: { interval_min: [1, 3], duration_h: [24, 24] },
  distributed_bots: { ip_count: [100, 500], clicks_per_ip: [1, 3], target_bot_share: [0.22, 0.29], duration_h: [6, 6] },
};

describe("attack injection", () => {
  it("sampled parameters stay within their documented ranges", () => {
    const rng = mulberry32(99);
    for (const kind of [...DESIGNED_ATTACKS, ...HELD_OUT_ATTACKS]) {
      for (let i = 0; i < 200; i++) {
        const p = sampleAttackParams(kind, rng);
        for (const [k, [lo, hi]] of Object.entries(RANGES[kind])) {
          expect(p[k], `${kind}.${k}`).toBeGreaterThanOrEqual(lo);
          expect(p[k], `${kind}.${k}`).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it("labels match the injected events (link, kind, time window)", () => {
    const rng = mulberry32(5);
    const [link] = makeSimLinks(1, rng);
    for (const kind of [...DESIGNED_ATTACKS, ...HELD_OUT_ATTACKS]) {
      const params = sampleAttackParams(kind, rng);
      const start = new Date("2026-03-10T08:00:00Z");
      const { events, label } = injectAttack(kind, params, { link: link!, start }, rng);
      expect(events.length).toBeGreaterThan(0);
      expect(label.kind).toBe(kind);
      expect(label.end.getTime() - label.start.getTime()).toBe(attackDuration(kind, params));
      for (const e of events) {
        expect(e.link_id).toBe(label.link_id);
        expect(e.scenario).toBe(kind);
        expect(e.at.getTime()).toBeGreaterThanOrEqual(label.start.getTime());
        expect(e.at.getTime()).toBeLessThan(label.end.getTime());
      }
    }
  });

  it("bot_burst uses at most ip_count distinct IPs and never converts", () => {
    const rng = mulberry32(11);
    const [link] = makeSimLinks(1, rng);
    const { events } = injectAttack("bot_burst", { ip_count: 2, clicks_per_10min: 40, bot_share: 1, duration_min: 20 }, { link: link!, start: new Date() }, rng);
    expect(new Set(events.map((e) => e.ip_hash)).size).toBeLessThanOrEqual(2);
    expect(events.every((e) => e.is_bot && !e.converted_signup)).toBe(true);
  });

  it("live demo parameters are strong enough to cross the designed thresholds", () => {
    expect(demoParams("bot_burst").clicks_per_10min).toBeGreaterThanOrEqual(20);
    expect(demoParams("click_farm").off_target_share).toBeGreaterThan(0.4);
  });

  it("row builder hashes simulated IP labels and links conversions to clicks", () => {
    const rng = mulberry32(3);
    const [link] = makeSimLinks(1, rng);
    const ev = { link_id: link!.id, at: new Date("2026-03-10T08:00:00Z"), ip_hash: "sim-n0-1", country_code: "NG", is_bot: false, converted_signup: true, converted_ftd: true, scenario: null };
    const rows = buildRows([ev], { dataset: "simulated", now: Date.parse("2026-03-10T09:00:00Z"), rng });
    expect(rows.clicks[0]!.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.conversions.map((c) => c.type)).toEqual(["signup", "ftd"]);
    expect(rows.conversions.every((c) => c.click_id === rows.clicks[0]!.id)).toBe(true);
    expect(rows.conversions.every((c) => Date.parse(c.occurred_at) <= Date.parse("2026-03-10T09:00:00Z"))).toBe(true);
  });
});
