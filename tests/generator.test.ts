import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/simulate/prng";
import {
  generateNormal,
  injectAttack,
  makeSimLinks,
  sampleAttackParams,
  type AttackKind,
} from "@/lib/simulate/generator";

const FROM = new Date("2026-09-01T00:00:00Z");
const TO = new Date("2026-09-03T00:00:00Z");

describe("traffic generator", () => {
  it("same seed -> identical output", () => {
    const run = () => {
      const rng = mulberry32(42);
      const links = makeSimLinks(3, rng);
      return generateNormal(links, FROM, TO, rng).map((e) => [e.link_id, e.at.getTime(), e.ip_hash, e.country_code, e.is_bot]);
    };
    expect(run()).toEqual(run());
  });

  it("different seeds -> different output", () => {
    const a = generateNormal(makeSimLinks(2, mulberry32(1)), FROM, TO, mulberry32(1));
    const b = generateNormal(makeSimLinks(2, mulberry32(2)), FROM, TO, mulberry32(2));
    expect(a.length === b.length && a.every((e, i) => e.at.getTime() === b[i]!.at.getTime())).toBe(false);
  });

  it("normal traffic stays within profile ranges", () => {
    const rng = mulberry32(7);
    const links = makeSimLinks(5, rng);
    const events = generateNormal(links, FROM, TO, rng);
    expect(events.every((e) => e.at >= FROM && e.at < TO)).toBe(true);
    const bots = events.filter((e) => e.is_bot).length / events.length;
    expect(bots).toBeGreaterThan(0.01);
    expect(bots).toBeLessThan(0.07);
    const signup = events.filter((e) => e.converted_signup).length / events.length;
    expect(signup).toBeGreaterThan(0.02);
    expect(signup).toBeLessThan(0.1);
  });

  const RANGES: Record<AttackKind, Record<string, [number, number]>> = {
    bot_burst: { ip_count: [1, 3], clicks_per_10min: [15, 80], bot_share: [0.6, 1], duration_min: [10, 40] },
    click_farm: { ip_count: [20, 200], off_target_share: [0.5, 0.95], duration_h: [2, 24], clicks_per_hour: [5, 40] },
    spike: { multiplier: [3, 15], duration_h: [1, 3] },
    slow_drip: { interval_min: [1, 3], duration_h: [24, 24] },
    distributed_bots: { ip_count: [100, 500], clicks_per_ip: [1, 3], target_bot_share: [0.22, 0.3], duration_h: [6, 6] },
  };

  it.each(Object.keys(RANGES) as AttackKind[])("%s params stay within ranges and labels match events", (kind) => {
    const rng = mulberry32(99);
    const [link] = makeSimLinks(1, rng);
    for (let i = 0; i < 30; i++) {
      const p = sampleAttackParams(kind, rng);
      for (const [k, [lo, hi]] of Object.entries(RANGES[kind])) {
        expect(p[k]).toBeGreaterThanOrEqual(lo);
        expect(p[k]).toBeLessThanOrEqual(hi);
      }
      const start = new Date("2026-09-02T10:00:00Z");
      const { events, label } = injectAttack(kind, p, { link: link!, start }, rng);
      expect(label.kind).toBe(kind);
      expect(label.link_id).toBe(link!.id);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.link_id).toBe(link!.id);
        expect(e.at >= label.start && e.at < label.end).toBe(true);
        expect(e.scenario).toBe(kind);
      }
      if (kind === "bot_burst") {
        expect(new Set(events.map((e) => e.ip_hash)).size).toBeLessThanOrEqual(p.ip_count!);
      }
      if (kind === "click_farm" || kind === "slow_drip" || kind === "distributed_bots") {
        expect(events.some((e) => e.converted_signup)).toBe(false);
      }
    }
  });
});
