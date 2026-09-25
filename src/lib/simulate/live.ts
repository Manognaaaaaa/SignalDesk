import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { attackDuration, injectAttack, trafficShape, withProfile, type AttackKind, type AttackParams } from "./generator";
import { mulberry32, pick } from "./prng";
import { buildRows, insertInBatches } from "./rows";

/**
 * Live attack simulator used by `npm run simulate` and POST /api/admin/simulate.
 * It writes one attack that ENDS NOW (dataset='simulated'), sends a few real requests through the
 * hot path, and leaves detection to the caller - so the demo shows the real production pipeline
 * turning traffic into an alert.
 *
 * The evaluation harness samples random attack strengths; the live demo deliberately uses fixed
 * "clearly visible" parameters so an alert reliably appears on screen. Held-out kinds can be
 * simulated too, and will usually NOT alert - which is the honest point of showing them.
 */

export const scenarioSchema = z.enum(["bot_burst", "click_farm", "spike", "slow_drip", "distributed_bots"]);
export type Scenario = z.infer<typeof scenarioSchema>;

export const MAX_EVENTS_PER_CALL = 2000;
const HOUR = 3_600_000;

/** Fixed demo-strength parameters per scenario (the eval harness uses random ranges instead). */
export function demoParams(kind: AttackKind): AttackParams {
  switch (kind) {
    case "bot_burst":
      return { ip_count: 1, clicks_per_10min: 60, bot_share: 0.9, duration_min: 10 };
    case "click_farm":
      return { ip_count: 80, off_target_share: 0.9, duration_h: 2, clicks_per_hour: 60 };
    case "spike":
      return { multiplier: 10, duration_h: 1, bot_share: 0.1, off_target_share: 0.1 };
    case "slow_drip":
      return { interval_min: 2, duration_h: 24 };
    case "distributed_bots":
      return { ip_count: 300, clicks_per_ip: 2, target_bot_share: 0.27, duration_h: 6 };
  }
}

export type SimulationResult = {
  scenario: Scenario;
  link_slug: string;
  events_written: number;
  conversions_written: number;
  hot_path_requests: { sent: number; redirected: number };
};

/** Sends n real GET requests to /r/<slug> without following redirects; counts 302s. Never throws. */
export async function probeHotPath(baseUrl: string, slug: string, n = 5): Promise<{ sent: number; redirected: number }> {
  let redirected = 0;
  for (let i = 0; i < n; i++) {
    try {
      const res = await fetch(new URL(`/r/${slug}`, baseUrl), {
        redirect: "manual",
        headers: { "user-agent": "curl/8.5.0 (linkpulse-simulator)" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 302) redirected++;
    } catch {
      // unreachable app: the simulation itself still succeeded
    }
  }
  return { sent: n, redirected };
}

/**
 * Writes one simulated attack on an active campaign link (random unless `slug` is given).
 * The link's recent hourly mean scales the attack so a "10x spike" is 10x THIS link's traffic.
 */
export async function runSimulation(
  db: SupabaseClient,
  opts: { scenario: Scenario; slug?: string; baseUrl?: string; now?: Date },
): Promise<SimulationResult> {
  const now = opts.now ?? new Date();
  const rng = mulberry32((now.getTime() % 2 ** 31) >>> 0);

  let q = db.from("links").select("id, slug, target_countries").eq("purpose", "campaign").eq("is_active", true);
  if (opts.slug) q = q.eq("slug", opts.slug);
  const { data: links, error } = await q.order("slug").limit(200);
  if (error) throw new Error(`link lookup failed: ${error.code ?? "unknown"}`);
  if (!links || links.length === 0) throw new Error("no active campaign link found (run npm run seed first)");
  const row = pick(rng, links) as { id: string; slug: string; target_countries: string[] };
  const targets = (row.target_countries ?? []).map((c) => c.trim().toUpperCase());

  const since = new Date(now.getTime() - 7 * 24 * HOUR).toISOString();
  const { data: hist } = await db.from("link_stats_hourly").select("clicks").eq("link_id", row.id).gte("hour", since);
  const total = (hist ?? []).reduce((a, h) => a + Number((h as { clicks: number }).clicks), 0);
  const hourlyMean = Math.max(5, total > 0 ? total / (7 * 24) : 20);

  // Calibrate the profile so expectedHourly(link, now) equals the observed mean.
  const profile = withProfile({ id: row.id, target_countries: targets.length ? targets : ["NG"] }, rng);
  const link = { ...profile, base_per_hour: hourlyMean / (1.5 * trafficShape(now.getTime())) };

  const params = demoParams(opts.scenario);
  const start = new Date(now.getTime() - attackDuration(opts.scenario, params));
  const { events } = injectAttack(opts.scenario, params, { link, start }, rng);
  const capped = events.slice(-MAX_EVENTS_PER_CALL); // keep the most recent events if over the cap

  const rows = buildRows(capped, { dataset: "simulated", now: now.getTime(), rng });
  await insertInBatches(db, "click_events", rows.clicks);
  await insertInBatches(db, "conversions", rows.conversions);
  await db.rpc("rollup_hourly", { p_since: start.toISOString() });

  const hot = opts.baseUrl ? await probeHotPath(opts.baseUrl, row.slug) : { sent: 0, redirected: 0 };
  return {
    scenario: opts.scenario,
    link_slug: row.slug,
    events_written: rows.clicks.length,
    conversions_written: rows.conversions.length,
    hot_path_requests: hot,
  };
}
