import { randomUUID } from "node:crypto";
import { isAllowedDestination } from "./allowed-destination";
import type { CachedLink } from "./link-cache";
import type { ClickContext } from "./log-click";

export const SLUG_RE = /^[a-z0-9-]{3,40}$/;

export type RedirectDeps = {
  allowedDomains: readonly string[];
  /** Cached active-link lookup; returns null if unknown/inactive. */
  findLink: (slug: string) => Promise<CachedLink | null>;
  /** Runs work after the response is sent (next/server after()). */
  schedule: (task: () => Promise<void>) => void;
  logClick: (ctx: ClickContext) => Promise<void>;
};

/** Generic 404 - identical for bad slug, unknown link and blocked destination (no probing oracle). */
function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
}

/**
 * THE HOT PATH. Validate -> look up (cache) -> re-check destination -> 302.
 * Logging is scheduled to run after the response; nothing here waits on logging, detection or AI,
 * and a logging failure can never turn a redirect into an error.
 */
export async function handleRedirect(req: Request, slug: string, deps: RedirectDeps): Promise<Response> {
  if (!SLUG_RE.test(slug)) return notFound();

  let link: CachedLink | null;
  try {
    link = await deps.findLink(slug);
  } catch {
    console.error("[redirect] link lookup failed");
    return notFound();
  }
  if (!link) return notFound();

  if (!isAllowedDestination(link.destination_url, deps.allowedDomains)) {
    console.warn(`[redirect] blocked destination for slug ${slug}`);
    return notFound();
  }

  const clickId = randomUUID();
  const dest = new URL(link.destination_url);
  dest.searchParams.set("lp_click_id", clickId); // URL API, never string concatenation

  const ctx: ClickContext = {
    link,
    clickId,
    at: new Date(),
    forwardedFor: req.headers.get("x-forwarded-for"),
    country: req.headers.get("x-vercel-ip-country"),
    userAgent: req.headers.get("user-agent"),
    referer: req.headers.get("referer"),
  };
  try {
    deps.schedule(() => deps.logClick(ctx));
  } catch {
    console.error("[redirect] could not schedule click logging");
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: dest.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}
