import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { AffiliateOption, AlertRow, Kpis, LinkSummary, SeriesPoint } from "@/lib/ui-types";

/**
 * Read models for the authenticated pages. Every query runs AS THE USER (anon key + session
 * cookie), so RLS decides what is visible: an affiliate can only ever load their own links,
 * clicks and alerts, even if this code had a bug. Failures return empty data (pages show an
 * empty/error state) rather than leaking database errors.
 */

const EMPTY_KPIS: Kpis = { clicks_24h: 0, unique_visitors_24h: 0, bot_clicks_24h: 0, signups_24h: 0, open_alerts: 0 };

export async function getKpis(includeReplay: boolean): Promise<Kpis> {
  const db = await supabaseServer();
  const { data, error } = await db.rpc("dashboard_kpis", { p_include_replay: includeReplay });
  if (error || !data?.[0]) return EMPTY_KPIS;
  const r = data[0] as Record<string, number>;
  return {
    clicks_24h: Number(r.clicks_24h),
    unique_visitors_24h: Number(r.unique_visitors_24h),
    bot_clicks_24h: Number(r.bot_clicks_24h),
    signups_24h: Number(r.signups_24h),
    open_alerts: Number(r.open_alerts),
  };
}

export async function getHourlySeries(hours: number, includeReplay: boolean, linkId?: string): Promise<SeriesPoint[]> {
  const db = await supabaseServer();
  const { data, error } = await db.rpc("hourly_series", {
    p_hours: hours,
    p_include_replay: includeReplay,
    p_link_id: linkId ?? null,
  });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    hour: String(r.hour),
    clicks: Number(r.clicks),
    bot_clicks: Number(r.bot_clicks),
    signups: Number(r.signups),
  }));
}

type AlertJoin = Omit<AlertRow, "link_slug" | "campaign_name"> & {
  links: { slug: string; campaign_name: string; purpose: string } | { slug: string; campaign_name: string; purpose: string }[] | null;
};

/** Latest alerts on visible links (campaign, plus replay if asked; one link if linkId given). */
export async function getAlerts(opts: { includeReplay: boolean; linkId?: string; limit?: number }): Promise<AlertRow[]> {
  const db = await supabaseServer();
  let q = db
    .from("alerts")
    .select(
      "id, link_id, rule_code, severity, window_start, window_end, evidence, status, resolution, ai_status, ai_summary, ai_likely_cause, ai_recommended_action, ai_explanation, created_at, links!inner(slug, campaign_name, purpose)",
    )
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.linkId) q = q.eq("link_id", opts.linkId);
  else q = q.in("links.purpose", opts.includeReplay ? ["campaign", "replay"] : ["campaign"]);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as unknown as AlertJoin[]).map(({ links, ...a }) => {
    const l = Array.isArray(links) ? links[0] : links;
    return { ...a, link_slug: l?.slug ?? "unknown", campaign_name: l?.campaign_name ?? "unknown" };
  });
}

export async function getLinkSummaries(includeReplay: boolean): Promise<LinkSummary[]> {
  const db = await supabaseServer();
  const { data, error } = await db.rpc("link_summaries", { p_include_replay: includeReplay });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    link_id: String(r.link_id),
    slug: String(r.slug),
    campaign_name: String(r.campaign_name),
    affiliate_name: r.affiliate_name ? String(r.affiliate_name) : null,
    purpose: String(r.purpose),
    is_active: Boolean(r.is_active),
    destination_url: String(r.destination_url),
    target_countries: ((r.target_countries as string[]) ?? []).map((c) => c.trim()),
    clicks_24h: Number(r.clicks_24h),
    signups_24h: Number(r.signups_24h),
    open_alerts: Number(r.open_alerts),
  }));
}

export async function getLink(linkId: string) {
  const db = await supabaseServer();
  const { data } = await db
    .from("links")
    .select("id, slug, campaign_name, destination_url, target_countries, purpose, is_active, created_at, affiliates(name, tier)")
    .eq("id", linkId)
    .maybeSingle();
  return data;
}

export async function getAffiliates(): Promise<AffiliateOption[]> {
  const db = await supabaseServer();
  const { data } = await db.from("affiliates").select("id, name").order("name");
  return (data ?? []) as AffiliateOption[];
}

/** Admin-only (RLS): recent job runs and LLM usage totals. */
export async function getSystemInfo() {
  const db = await supabaseServer();
  const [jobs, usage] = await Promise.all([
    db.from("job_runs").select("id, job, started_at, finished_at, status, stats").order("started_at", { ascending: false }).limit(25),
    db.rpc("llm_usage_summary", { p_days: 30 }),
  ]);
  return {
    jobs: (jobs.data ?? []) as { id: string; job: string; started_at: string; finished_at: string | null; status: string; stats: Record<string, unknown> }[],
    usage: (usage.data?.[0] ?? null) as Record<string, number | string> | null,
  };
}
