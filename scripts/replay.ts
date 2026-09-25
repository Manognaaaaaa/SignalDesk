/**
 * npm run replay                     -> runs the TalkingData replay suite in memory (same as eval --suite replay)
 * npm run replay -- --to-db [--reset] [--anchor 2026-09-25T12:00:00Z]
 *   -> also loads the replay into Supabase (dataset='replay', purpose='replay' links "td-ch-<channel>",
 *      batch inserts of 1,000) so it can be browsed with the dashboard's "Include replay" filter.
 *      Timestamps are shifted so the last click lands at the anchor (default: the current hour);
 *      relative gaps are preserved. Country and user agent are unknown (NULL).
 * Missing CSV -> prints how to obtain it and exits 0 (not a failure).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";
import { makeRecord, writeResult, insertEvalRun } from "@/eval/report";
import { DEFAULT_REPLAY_PATH, REPLAY_HELP, runReplay } from "@/eval/suites/replay";
import { loadTalkingData, replaySlug } from "@/eval/talkingdata-loader";
import { insertInBatches } from "@/lib/simulate/rows";
import { adminClient, optionalEnv, parseArgs, requireEnv } from "./lib/env";
import { gitSha, optionalAdminClient } from "./lib/meta";

async function toDb(args: Record<string, string | true>) {
  const env = requireEnv("IP_HASH_SALT", "ALLOWED_DESTINATION_DOMAINS");
  const db = adminClient();
  const maxRows = Number(optionalEnv("REPLAY_MAX_ROWS") ?? 200_000);
  const load = await loadTalkingData(DEFAULT_REPLAY_PATH, { salt: env.IP_HASH_SALT!, maxRows });
  if (load.events.length === 0) throw new Error("no valid rows");

  const { count } = await db.from("click_events").select("id", { count: "exact", head: true }).eq("dataset", "replay");
  if ((count ?? 0) > 0 && !args.reset) {
    console.log(`Replay already loaded (${count} clicks). Use --reset to reload.`);
    return;
  }
  if (args.reset) {
    const { error } = await db.from("click_events").delete().eq("dataset", "replay");
    if (error) throw new Error(`reset failed: ${error.message}`);
  }

  const anchorArg = typeof args.anchor === "string" ? z.iso.datetime({ offset: true }).safeParse(args.anchor) : null;
  if (anchorArg && !anchorArg.success) throw new Error("--anchor must be an ISO datetime");
  const anchor = anchorArg?.success ? Date.parse(anchorArg.data) : Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const shift = anchor - load.events[load.events.length - 1]!.at.getTime();

  // Affiliate + one replay link per channel (idempotent).
  const affName = "Replay dataset (TalkingData)";
  let { data: aff } = await db.from("affiliates").select("id").eq("name", affName).maybeSingle();
  if (!aff) {
    const ins = await db.from("affiliates").insert({ name: affName, country_code: "ZZ", tier: null }).select("id").single();
    if (ins.error) throw new Error(`affiliate insert failed: ${ins.error.message}`);
    aff = ins.data;
  }
  const domain = env.ALLOWED_DESTINATION_DOMAINS!.split(",")[0]!.trim().toLowerCase();
  const linkRows = load.links.map((l) => ({
    slug: l.id,
    campaign_name: `TalkingData ${l.id.replace("td-ch-", "channel ")}`,
    affiliate_id: aff!.id,
    destination_url: `https://${domain}/replay`,
    target_countries: [] as string[],
    purpose: "replay",
    is_active: true,
  }));
  const idBySlug = new Map<string, string>();
  for (let i = 0; i < linkRows.length; i += 500) {
    const { data, error } = await db.from("links").upsert(linkRows.slice(i, i + 500), { onConflict: "slug" }).select("id, slug");
    if (error) throw new Error(`links upsert failed: ${error.message}`);
    for (const r of data ?? []) idBySlug.set(r.slug, r.id);
  }

  const clicks: object[] = [];
  const conversions: object[] = [];
  for (const e of load.events) {
    const id = randomUUID();
    const linkId = idBySlug.get(replaySlug(e.channel))!;
    clicks.push({
      id,
      link_id: linkId,
      clicked_at: new Date(e.at.getTime() + shift).toISOString(),
      ip_hash: e.ip_hash,
      country_code: null,
      ua_family: "unknown",
      device_type: "unknown",
      is_bot: null,
      referrer_domain: null,
      dataset: "replay",
      scenario: "talkingdata",
    });
    if (e.attributed_at) {
      conversions.push({
        event_id: `td-${id}`,
        click_id: id,
        link_id: linkId,
        type: "signup",
        amount_usd: null,
        occurred_at: new Date(e.attributed_at.getTime() + shift).toISOString(),
      });
    }
  }
  console.log(`Inserting ${clicks.length} replay clicks and ${conversions.length} conversions...`);
  await insertInBatches(db, "click_events", clicks, 1000, (d) => d % 20_000 === 0 && console.log(`  ${d}/${clicks.length}`));
  await insertInBatches(db, "conversions", conversions, 1000);
  const since = new Date(load.events[0]!.at.getTime() + shift).toISOString();
  const { error } = await db.rpc("rollup_hourly", { p_since: since });
  if (error) throw new Error(`rollup failed: ${error.message}`);
  await db.from("job_runs").insert({ job: "replay", finished_at: new Date().toISOString(), status: "ok", stats: { clicks: clicks.length, conversions: conversions.length, links: linkRows.length } });
  console.log("Replay loaded. Open the dashboard with 'Include replay'.");
}

async function main() {
  const args = parseArgs();
  if (!existsSync(DEFAULT_REPLAY_PATH)) {
    console.log(REPLAY_HELP);
    return;
  }
  const salt = optionalEnv("IP_HASH_SALT") ?? "linkpulse-eval-local";
  const r = await runReplay({ salt, maxRows: Number(optionalEnv("REPLAY_MAX_ROWS") ?? 200_000), onProgress: (m) => console.log(`  ${m}`) });
  const rec = makeRecord("replay", null, gitSha(), r.summary, r.details);
  console.log(`wrote ${writeResult(rec)}`);
  const db = optionalAdminClient();
  if (db && !r.summary.skipped) console.log((await insertEvalRun(db, rec)) ? "stored eval_runs row" : "eval_runs insert failed");
  if (args["to-db"]) await toDb(args);
}

main().catch((e) => {
  console.error(`replay failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
