import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DETECTION_CONFIG, type RuleCode } from "@/config/detection";
import { explainAlert } from "@/lib/ai/explain";
import { evaluate } from "./engine";
import { computeStatsFromDb } from "./stats-sql";

export type DetectionRunStats = {
  links_checked: number;
  fired: number;
  inserted: number;
  deduped: number;
  skipped_by_rule: Partial<Record<RuleCode, number>>;
  explained: number;
  llm_calls: number;
  duration_ms: number;
};

type InsertedAlert = { id: string; link_id: string; rule_code: RuleCode; severity: string; evidence: Record<string, unknown> };

/**
 * The cold-path detection job (called by pg_cron every 5 minutes, or by an admin):
 *   rollup_hourly -> stats from SQL -> deterministic rules -> insert alerts (ON CONFLICT DO NOTHING)
 *   -> explain only the NEW alerts (capped per run) -> job_runs audit row.
 * Idempotent: a second run in the same window inserts nothing new because of the unique key.
 * One failed explanation never fails the job - the alert simply keeps ai_status 'pending'/'failed'.
 */
export async function runDetection(db: SupabaseClient, opts: { maxExplanations: number; now?: Date }): Promise<DetectionRunStats> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const startedAt = new Date(started).toISOString();
  let status: "ok" | "partial" | "failed" = "ok";
  const stats: DetectionRunStats = {
    links_checked: 0,
    fired: 0,
    inserted: 0,
    deduped: 0,
    skipped_by_rule: {},
    explained: 0,
    llm_calls: 0,
    duration_ms: 0,
  };

  try {
    const roll = await db.rpc("rollup_hourly", { p_since: new Date(now.getTime() - 2 * 3_600_000).toISOString() });
    if (roll.error) status = "partial";

    const statsList = await computeStatsFromDb(db, now);
    stats.links_checked = statsList.length;
    const outcome = evaluate(statsList, DETECTION_CONFIG);
    stats.fired = outcome.fired.length;
    stats.skipped_by_rule = outcome.skippedByRule;

    let inserted: InsertedAlert[] = [];
    if (outcome.fired.length > 0) {
      const rows = outcome.fired.map((r) => ({
        link_id: r.link_id,
        rule_code: r.rule_code,
        severity: r.severity,
        window_start: r.window_start.toISOString(),
        window_end: r.window_end.toISOString(),
        evidence: r.evidence,
      }));
      const { data, error } = await db
        .from("alerts")
        .upsert(rows, { onConflict: "link_id,rule_code,window_start", ignoreDuplicates: true })
        .select("id, link_id, rule_code, severity, evidence");
      if (error) throw new Error(`alert insert failed: ${error.code ?? "unknown"}`);
      inserted = (data ?? []) as InsertedAlert[];
    }
    stats.inserted = inserted.length;
    stats.deduped = stats.fired - stats.inserted;

    const toExplain = inserted.slice(0, opts.maxExplanations);
    if (toExplain.length > 0) {
      const { data: links } = await db
        .from("links")
        .select("id, campaign_name, target_countries, affiliates(tier)")
        .in("id", [...new Set(toExplain.map((a) => a.link_id))]);
      const byId = new Map((links ?? []).map((l) => [l.id as string, l]));
      for (const alert of toExplain) {
        try {
          const l = byId.get(alert.link_id) as
            | { campaign_name: string; target_countries: string[]; affiliates: { tier: string | null } | { tier: string | null }[] | null }
            | undefined;
          const aff = Array.isArray(l?.affiliates) ? l?.affiliates[0] : l?.affiliates;
          const out = await explainAlert({
            alert_id: alert.id,
            rule_code: alert.rule_code,
            severity: alert.severity,
            evidence: alert.evidence,
            link: {
              campaign_name: l?.campaign_name ?? "unknown",
              target_countries: l?.target_countries ?? [],
              affiliate_tier: aff?.tier ?? null,
            },
          });
          stats.llm_calls += out.llm_calls;
          const { error } = await db
            .from("alerts")
            .update({
              ai_status: out.ai_status,
              ai_summary: out.ai_summary,
              ai_likely_cause: out.ai_likely_cause,
              ai_recommended_action: out.ai_recommended_action,
              ai_explanation: out.ai_explanation,
            })
            .eq("id", alert.id);
          if (error) status = "partial";
          else stats.explained++;
        } catch {
          status = "partial";
          console.error("[detect] explanation failed for one alert");
        }
      }
    }
  } catch (e) {
    status = "failed";
    console.error(`[detect] run failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
  }

  stats.duration_ms = Date.now() - started;
  try {
    await db.from("job_runs").insert({
      job: "detect",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      stats,
    });
  } catch {
    console.error("[detect] could not write job_runs");
  }
  if (status === "failed") throw new Error("detection failed");
  return stats;
}
