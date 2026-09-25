import { describe, expect, it } from "vitest";
import { explainedByAttack, falseAlarms, matchAttack, type EvalAlert } from "@/eval/matching";
import { percentile, twoProportionZ, wilson } from "@/eval/metrics";
import { configHash, renderResultsMarkdown, replaceBetweenMarkers } from "@/eval/report";
import { runRandomised } from "@/eval/suites/randomised";
import { breakingPoint } from "@/eval/suites/sensitivity";

describe("Wilson confidence interval", () => {
  it("matches known values", () => {
    const a = wilson(8, 10);
    expect(a.rate).toBe(0.8);
    expect(a.low).toBeCloseTo(0.4902, 3);
    expect(a.high).toBeCloseTo(0.9433, 3);
    const b = wilson(0, 10);
    expect(b.low).toBe(0);
    expect(b.high).toBeCloseTo(0.2775, 3);
    const c = wilson(50, 50);
    expect(c.high).toBe(1);
    expect(c.low).toBeCloseTo(0.9287, 3);
  });
  it("is defined for n = 0", () => expect(wilson(0, 0)).toEqual({ rate: 0, low: 0, high: 0 }));
});

describe("two-proportion z-test", () => {
  it("matches a textbook example", () => {
    const t = twoProportionZ(45, 100, 56, 100);
    expect(t.z).toBeCloseTo(-1.5556, 3);
    expect(t.p_value).toBeCloseTo(0.1198, 3);
  });
  it("detects a large difference", () => {
    const t = twoProportionZ(2, 10_000, 250, 100_000);
    expect(t.p1).toBeCloseTo(0.0002);
    expect(t.p_value).toBeLessThan(0.05);
  });
  it("handles empty groups", () => expect(twoProportionZ(0, 0, 5, 10).p_value).toBe(1));
});

describe("percentiles", () => {
  it("interpolates linearly", () => {
    expect(percentile([4, 1, 3, 2], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 90)).toBeCloseTo(3.7);
    expect(percentile([], 50)).toBeNull();
  });
});

const LINK = "link-a";
const START = new Date("2026-03-10T12:00:00Z");
const END = new Date("2026-03-10T12:30:00Z");
const label = { kind: "bot_burst" as const, link_id: LINK, start: START, end: END };
const alert = (over: Partial<EvalAlert>): EvalAlert => ({
  link_id: LINK,
  rule_code: "IP_BURST",
  severity: "high",
  at: new Date("2026-03-10T12:10:00Z"),
  window_start: new Date("2026-03-10T12:10:00Z"),
  evidence: {},
  ...over,
});

describe("attack-to-alert matching", () => {
  it("detects an expected rule inside the window and computes time to detect", () => {
    const m = matchAttack(label, [alert({})]);
    expect(m.detected).toBe(true);
    expect(m.time_to_detect_ms).toBe(10 * 60_000);
    expect(m.rules_fired).toEqual(["IP_BURST"]);
  });
  it("accepts alerts up to 15 minutes after the attack ends, not later", () => {
    expect(matchAttack(label, [alert({ at: new Date(END.getTime() + 15 * 60_000) })]).detected).toBe(true);
    expect(matchAttack(label, [alert({ at: new Date(END.getTime() + 16 * 60_000) })]).detected).toBe(false);
    expect(matchAttack(label, [alert({ at: new Date(START.getTime() - 60_000) })]).detected).toBe(false);
  });
  it("ignores the wrong rule and the wrong link", () => {
    expect(matchAttack(label, [alert({ rule_code: "CLICK_SPIKE" })]).detected).toBe(false);
    expect(matchAttack(label, [alert({ rule_code: "CLICK_SPIKE" })]).any_rules_in_window).toEqual(["CLICK_SPIKE"]);
    expect(matchAttack(label, [alert({ link_id: "other" })]).detected).toBe(false);
  });
  it("held-out kinds accept any rule (generous by design)", () => {
    expect(matchAttack({ ...label, kind: "slow_drip" }, [alert({ rule_code: "CLICK_SPIKE" })]).detected).toBe(true);
  });
  it("false alarms: alerts whose look-back window contains no attack", () => {
    const late24h = alert({ rule_code: "NO_CONVERSIONS", at: new Date(END.getTime() + 20 * 3_600_000) });
    expect(explainedByAttack(late24h, [label])).toBe(true); // 24 h look-back still sees the attack
    const lateIp = alert({ at: new Date(END.getTime() + 60 * 60_000) });
    expect(explainedByAttack(lateIp, [label])).toBe(false); // 10 min look-back does not
    expect(falseAlarms([alert({}), lateIp, alert({ link_id: "other" })], [label])).toHaveLength(2);
  });
});

describe("sensitivity breaking point", () => {
  it("is the lowest level from which detection stays >= 90%", () => {
    const lv = (rates: number[]) => rates.map((rate, i) => ({ level: i + 1, rate }));
    expect(breakingPoint(lv([0.1, 0.5, 0.95, 1]))).toBe(3);
    expect(breakingPoint(lv([0.1, 0.95, 0.8, 1]))).toBe(4); // a dip resets it
    expect(breakingPoint(lv([0.1, 0.5]))).toBeNull();
  });
});

describe("harness reproducibility and reporting", () => {
  it("same seed -> identical randomised results", () => {
    const a = runRandomised({ seed: 7, trials: 2 });
    const b = runRandomised({ seed: 7, trials: 2 });
    expect(a.summary).toEqual(b.summary);
    expect(a.details.trials.map((t) => t.params)).toEqual(b.details.trials.map((t) => t.params));
  });
  it("config hash is stable and short", () => {
    expect(configHash()).toMatch(/^[0-9a-f]{16}$/);
    expect(configHash()).toBe(configHash());
  });
  it("README markers are replaced, not duplicated", () => {
    const md = "a\n<!-- EVAL:START -->\nold\n<!-- EVAL:END -->\nb";
    const out = replaceBetweenMarkers(md, "new");
    expect(out).toContain("new");
    expect(out).not.toContain("old");
    expect(out.match(/EVAL:START/g)).toHaveLength(1);
    expect(renderResultsMarkdown({})).toContain("No results yet");
  });
});
