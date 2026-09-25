import * as crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { bearerMatches, safeEqual, signPayload, verifyWebhook } from "@/lib/webhook/hmac";
import { conversionSchema } from "@/lib/webhook/conversion-schema";

vi.mock("node:crypto", async (orig) => {
  const real = await orig<typeof import("node:crypto")>();
  return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) };
});

const SECRET = "test-secret-abcdefghijklmnop";
const NOW = 1_800_000_000_000;
const TS = String(NOW / 1000);
const BODY = '{"event_id":"evt_12345678"}';

describe("webhook HMAC", () => {
  it("accepts a valid signature", () => {
    expect(verifyWebhook(SECRET, BODY, TS, signPayload(SECRET, TS, BODY), NOW)).toEqual({ ok: true });
  });

  it("uses crypto.timingSafeEqual for the comparison", () => {
    const spy = vi.mocked(crypto.timingSafeEqual);
    spy.mockClear();
    verifyWebhook(SECRET, BODY, TS, signPayload(SECRET, TS, BODY), NOW);
    expect(spy).toHaveBeenCalled();
  });

  it("rejects a tampered body", () => {
    const sig = signPayload(SECRET, TS, BODY);
    expect(verifyWebhook(SECRET, BODY.replace("1234", "9999"), TS, sig, NOW).ok).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyWebhook(SECRET, BODY, TS, signPayload("another-secret-xyz12345", TS, BODY), NOW).ok).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyWebhook(SECRET, BODY, null, "sha256=00", NOW)).toEqual({ ok: false, reason: "missing" });
    expect(verifyWebhook(SECRET, BODY, TS, null, NOW)).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a signature of different length without throwing", () => {
    expect(verifyWebhook(SECRET, BODY, TS, "sha256=abc", NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(safeEqual("a", "abc")).toBe(false);
  });

  it("rejects old and future timestamps (replay window 300 s)", () => {
    const old = String(NOW / 1000 - 301);
    expect(verifyWebhook(SECRET, BODY, old, signPayload(SECRET, old, BODY), NOW)).toEqual({ ok: false, reason: "stale" });
    const future = String(NOW / 1000 + 301);
    expect(verifyWebhook(SECRET, BODY, future, signPayload(SECRET, future, BODY), NOW).ok).toBe(false);
  });

  it("rejects non-numeric timestamps", () => {
    expect(verifyWebhook(SECRET, BODY, "12abc", "sha256=00", NOW)).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("bearer check is exact", () => {
    expect(bearerMatches("Bearer s3cret-value-123456", "s3cret-value-123456")).toBe(true);
    expect(bearerMatches("Bearer wrong", "s3cret-value-123456")).toBe(false);
    expect(bearerMatches("s3cret-value-123456", "s3cret-value-123456")).toBe(false);
    expect(bearerMatches(null, "s3cret-value-123456")).toBe(false);
  });
});

describe("conversion schema", () => {
  const now = () => NOW;
  const base = {
    event_id: "evt_12345678",
    click_id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    type: "signup",
    occurred_at: new Date(NOW - 60_000).toISOString(),
  };
  const parse = (v: unknown) => conversionSchema(now).safeParse(v).success;

  it("accepts a valid signup and ftd", () => {
    expect(parse(base)).toBe(true);
    expect(parse({ ...base, type: "ftd", amount_usd: 50 })).toBe(true);
  });
  it("requires amount for ftd", () => expect(parse({ ...base, type: "ftd" })).toBe(false));
  it("rejects unknown type", () => expect(parse({ ...base, type: "deposit" })).toBe(false));
  it("rejects bad event_id format", () => {
    expect(parse({ ...base, event_id: "short" })).toBe(false);
    expect(parse({ ...base, event_id: "has spaces in it!" })).toBe(false);
    expect(parse({ ...base, event_id: "x".repeat(65) })).toBe(false);
  });
  it("rejects amounts out of range", () => {
    expect(parse({ ...base, type: "ftd", amount_usd: -1 })).toBe(false);
    expect(parse({ ...base, type: "ftd", amount_usd: 1_000_001 })).toBe(false);
  });
  it("rejects future and too-old dates", () => {
    expect(parse({ ...base, occurred_at: new Date(NOW + 6 * 60_000).toISOString() })).toBe(false);
    expect(parse({ ...base, occurred_at: new Date(NOW - 31 * 86_400_000).toISOString() })).toBe(false);
  });
  it("rejects non-uuid click ids and extra fields like link_id", () => {
    expect(parse({ ...base, click_id: "not-a-uuid" })).toBe(false);
    expect(parse({ ...base, link_id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f" })).toBe(false);
  });
});
