import "server-only";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CachedLink } from "./link-cache";
import { classifyUserAgent } from "./ua";
import { clientIp, hashIp, referrerDomain } from "./ip-hash";

/** Request data captured synchronously in the handler, before the response is sent. */
export type ClickContext = {
  link: CachedLink;
  clickId: string;
  at: Date;
  forwardedFor: string | null;
  country: string | null;
  userAgent: string | null;
  referer: string | null;
};

export const SOFT_LIMIT_PER_MINUTE = 120;

/**
 * Per-instance soft limiter: after 120 clicks/minute from one ip_hash on one link we stop
 * inserting individual rows (protects the DB from floods) but NEVER block the redirect.
 */
const minuteCounts = new Map<string, number>();
let droppedRows = 0;
let lastPrune = 0;

export function softLimitExceeded(ipHash: string, linkId: string, at: Date): boolean {
  const minute = Math.floor(at.getTime() / 60_000);
  if (minute !== lastPrune) {
    for (const k of minuteCounts.keys()) if (!k.endsWith(`|${minute}`)) minuteCounts.delete(k);
    lastPrune = minute;
  }
  const key = `${ipHash}|${linkId}|${minute}`;
  const n = (minuteCounts.get(key) ?? 0) + 1;
  minuteCounts.set(key, n);
  return n > SOFT_LIMIT_PER_MINUTE;
}

/** Broadcast throttle: at most one live-ticker event per 200 ms per instance. */
let lastBroadcast = 0;

/**
 * Logs one click AFTER the redirect response was sent (called from next/server after()).
 * Never throws: every failure is caught and logged without IPs, UAs or secrets.
 */
export async function logClick(ctx: ClickContext): Promise<void> {
  try {
    const env = serverEnv();
    const ipHash = hashIp(clientIp(ctx.forwardedFor), env.IP_HASH_SALT, ctx.at);
    if (softLimitExceeded(ipHash, ctx.link.id, ctx.at)) {
      droppedRows++;
      if (droppedRows % 100 === 1) console.warn(`[click] soft limit active, dropped rows so far: ${droppedRows}`);
      return;
    }
    const ua = classifyUserAgent(ctx.userAgent);
    const country = ctx.country && /^[A-Za-z]{2}$/.test(ctx.country) ? ctx.country.toUpperCase() : null;
    const db = supabaseAdmin();
    const { error } = await db.from("click_events").insert({
      id: ctx.clickId,
      link_id: ctx.link.id,
      clicked_at: ctx.at.toISOString(),
      ip_hash: ipHash,
      country_code: country,
      ua_family: ua.ua_family,
      device_type: ua.device_type,
      is_bot: ua.is_bot,
      referrer_domain: referrerDomain(ctx.referer),
      dataset: "live",
      scenario: null,
    });
    if (error) {
      console.error(`[click] insert failed: ${error.code ?? "unknown"}`);
      return;
    }
    const now = Date.now();
    if (ctx.link.purpose === "campaign" && now - lastBroadcast > 200) {
      lastBroadcast = now;
      await db
        .channel("clicks")
        .httpSend("click", { link_slug: ctx.link.slug, country_code: country, is_bot: ua.is_bot, at: ctx.at.toISOString() })
        .catch(() => undefined);
    }
  } catch (e) {
    console.error(`[click] logging failed: ${e instanceof Error ? e.name : "unknown"}`);
  }
}
