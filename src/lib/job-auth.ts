import { bearerMatches } from "@/lib/webhook/hmac";

/**
 * Authorizes a job trigger: a valid "Bearer <CRON_SECRET>" (pg_cron) OR a logged-in admin.
 * The bearer is compared in constant time. isAdmin is only consulted if no bearer matched.
 */
export async function authorizeJob(req: Request, cronSecret: string, isAdmin: () => Promise<boolean>): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (auth) return bearerMatches(auth, cronSecret); // a wrong bearer is a hard no, no session fallback
  try {
    return await isAdmin();
  } catch {
    return false;
  }
}
