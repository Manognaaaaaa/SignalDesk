import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison; unequal lengths are rejected first (timingSafeEqual throws on them). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** True if the header is exactly "Bearer <secret>" (constant-time). */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("Bearer ") || !secret) return false;
  return safeEqual(header.slice(7), secret);
}

/** True if the email is in the ADMIN_EMAILS allowlist (case-insensitive). */
export function isAdminEmail(email: string | null | undefined, adminEmails: readonly string[]): boolean {
  return Boolean(email) && adminEmails.includes(email!.trim().toLowerCase());
}

/**
 * Authorizes the ingest job: a valid "Bearer <CRON_SECRET>" (pg_cron) OR a logged-in user whose
 * email is allowlisted. A wrong bearer is a hard no - it never falls back to the session.
 */
export async function authorizeJob(req: Request, cronSecret: string, adminEmails: readonly string[], sessionEmail: () => Promise<string | null>): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (auth) return bearerMatches(auth, cronSecret);
  try {
    return isAdminEmail(await sessionEmail(), adminEmails);
  } catch {
    return false;
  }
}
