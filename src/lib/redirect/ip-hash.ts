import { createHash } from "node:crypto";

/**
 * Privacy-preserving visitor key: sha256(salt + ip + UTC date).
 * - The salt is secret, so hashes cannot be reversed with a rainbow table of all IPv4s.
 * - The UTC date rotates the hash daily, so a visitor cannot be tracked across days.
 * The raw IP is never returned, stored or logged.
 */
export function hashIp(ip: string, salt: string, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return createHash("sha256").update(`${salt}${ip}${day}`).digest("hex");
}

/** First entry of x-forwarded-for (the client as seen by Vercel's edge), or "unknown". */
export function clientIp(forwardedFor: string | null): string {
  const first = (forwardedFor ?? "").split(",")[0]?.trim();
  return first && first.length <= 64 ? first : "unknown";
}

/** Referrer reduced to a lowercased hostname (max 100 chars), or null if absent/invalid. */
export function referrerDomain(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase();
    return h ? h.slice(0, 100) : null;
  } catch {
    return null;
  }
}
