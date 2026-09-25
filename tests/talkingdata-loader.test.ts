import { describe, expect, it } from "vitest";
import type { EvalAlert } from "@/eval/matching";
import { replayProxyMetrics } from "@/eval/suites/replay";
import { loadTalkingData, tdIpHash } from "@/eval/talkingdata-loader";

// Synthetic rows in the TalkingData column layout (no real dataset rows are committed).
const SAMPLE = "tests/fixtures/talkingdata/sample.csv";
const BAD_HEADER = "tests/fixtures/talkingdata/bad-header.csv";

describe("TalkingData loader", () => {
  it("maps valid rows and skips malformed ones without failing", async () => {
    const r = await loadTalkingData(SAMPLE, { salt: "test-salt", maxRows: 1000 });
    expect(r.rows_read).toBe(20);
    expect(r.rows_malformed).toBe(4); // bad ip, bad date, bad is_attributed, short row
    expect(r.rows_valid).toBe(16);
    expect(r.links.map((l) => l.id)).toEqual(["td-ch-101", "td-ch-202", "td-ch-303"]);
    expect(r.events.filter((e) => e.converted_signup)).toHaveLength(3);
  });

  it("hashes IPs, leaves country/bot unknown and keeps UTC timestamps", async () => {
    const r = await loadTalkingData(SAMPLE, { salt: "test-salt", maxRows: 1000 });
    const e = r.events[0]!;
    expect(e.ip_hash).toBe(tdIpHash("1001", "test-salt"));
    expect(e.ip_hash).not.toContain("1001");
    expect(e.country_code).toBeNull();
    expect(e.is_bot).toBeNull();
    expect(e.at.toISOString()).toBe("2020-01-01T10:00:00.000Z");
    expect(r.events.every((x, i) => i === 0 || x.at >= r.events[i - 1]!.at)).toBe(true);
  });

  it("uses the click time when attributed_time is missing on a conversion", async () => {
    const r = await loadTalkingData(SAMPLE, { salt: "s", maxRows: 1000 });
    const conv = r.events.find((e) => e.channel === "303" && e.converted_signup)!;
    expect(conv.attributed_at?.toISOString()).toBe(conv.at.toISOString());
    const withTime = r.events.find((e) => e.channel === "202" && e.converted_signup)!;
    expect(withTime.attributed_at!.getTime()).toBeGreaterThan(withTime.at.getTime());
  });

  it("respects the row cap", async () => {
    const r = await loadTalkingData(SAMPLE, { salt: "s", maxRows: 5 });
    expect(r.rows_read).toBe(5);
  });

  it("rejects a file with the wrong header (e.g. test.csv)", async () => {
    await expect(loadTalkingData(BAD_HEADER, { salt: "s", maxRows: 10 })).rejects.toThrow(/unexpected CSV header/);
  });
});

describe("replay proxy metrics", () => {
  it("compares attribution of flagged vs unflagged clicks and burst IPs", async () => {
    const r = await loadTalkingData(SAMPLE, { salt: "s", maxRows: 1000 });
    // Pretend IP_BURST fired on channel 101 at 10:10 (look-back 10 min: clicks 10:00:00 excluded, 10:01-10:10 included).
    const alerts: EvalAlert[] = [
      { link_id: "td-ch-101", rule_code: "IP_BURST", severity: "high", at: new Date("2020-01-01T10:10:00Z"), window_start: new Date("2020-01-01T10:10:00Z"), evidence: {} },
    ];
    const m = replayProxyMetrics(r.events, alerts);
    expect(m.flagged.clicks).toBe(8);
    expect(m.flagged.attributed).toBe(0);
    expect(m.unflagged.clicks).toBe(8);
    expect(m.unflagged.attributed).toBe(3);
    expect(m.attribution_ratio).toBe(0);
    expect(m.burst_ips.ips).toBe(1); // ip 1001 made the most clicks in that window
    expect(m.top_channels[0]!.channel).toBe("101");
  });
});
