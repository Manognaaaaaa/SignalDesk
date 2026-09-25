import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_SKEW_SECONDS = 300;

/** Computes the webhook signature header value: "sha256=" + HMAC-SHA256(secret, `${ts}.${body}`). */
export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

/** Constant-time string comparison; unequal lengths are rejected before timingSafeEqual (which throws on them). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "bad_timestamp" | "stale" | "bad_signature" };

/**
 * Verifies a signed webhook. The signature covers the timestamp AND the raw body, and the
 * timestamp must be within 5 minutes, so a captured request cannot be replayed later.
 * The raw body string is used exactly as received (never re-serialised JSON).
 */
export function verifyWebhook(
  secret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  nowMs: number = Date.now(),
): VerifyResult {
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };
  const expected = signPayload(secret, timestamp, rawBody);
  return safeEqual(expected, signature) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

/** Bearer-token check for the cron endpoint, constant-time. */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  return safeEqual(header.slice(7), secret);
}
