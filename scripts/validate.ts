/**
 * npm run validate
 * End-to-end smoke check against a running app (APP_BASE_URL) and the Supabase project.
 * Prints PASS/FAIL per line (never secret values) and exits non-zero on any failure.
 * Order: env -> schema/RLS -> hot path -> webhook -> simulate + detect (+ idempotency) -> eval -> security-check.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { runSimulation } from "@/lib/simulate/live";
import { signPayload } from "@/lib/webhook/hmac";
import { adminClient, optionalEnv } from "./lib/env";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CONVERSION_WEBHOOK_SECRET",
  "CRON_SECRET",
  "IP_HASH_SALT",
  "ALLOWED_DESTINATION_DOMAINS",
  "APP_BASE_URL",
];
const TABLES = ["profiles", "affiliates", "links", "click_events", "conversions", "link_stats_hourly", "alerts", "llm_calls", "job_runs", "eval_runs"];

let failures = 0;
function line(ok: boolean, what: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` - ${detail}` : ""}`);
}

async function main() {
  // 1. Env (names only).
  const missing = REQUIRED.filter((n) => !optionalEnv(n));
  line(missing.length === 0, "required env vars present", missing.length ? `missing: ${missing.join(", ")}` : `${REQUIRED.length} set`);
  line(true, "GROQ_API_KEY", optionalEnv("GROQ_API_KEY") ? "set (AI explanations)" : "not set (template explanations)");
  if (missing.length) process.exit(1);

  const db = adminClient();
  const base = optionalEnv("APP_BASE_URL")!;
  const cron = optionalEnv("CRON_SECRET")!;

  // 2. Tables and RLS.
  for (const t of TABLES) {
    const { error } = await db.from(t).select("*", { count: "exact", head: true });
    line(!error, `table ${t} exists`, error?.code ?? "");
  }
  const { data: rls, error: rlsErr } = await db.rpc("rls_status");
  const off = ((rls ?? []) as { table_name: string; rls_enabled: boolean }[]).filter((r) => !r.rls_enabled).map((r) => r.table_name);
  line(!rlsErr && off.length === 0, "RLS enabled on every public table", rlsErr ? rlsErr.code ?? "rpc failed" : off.length ? `off: ${off.join(", ")}` : `${rls?.length} tables`);

  // 3. Hot path.
  const { data: link } = await db.from("links").select("slug").eq("purpose", "campaign").eq("is_active", true).order("slug").limit(1).maybeSingle();
  if (!link) line(false, "an active campaign link exists", "run npm run seed");
  else {
    const r = await fetch(new URL(`/r/${link.slug}`, base), { redirect: "manual" }).catch(() => null);
    const loc = r?.headers.get("location") ?? "";
    line(r?.status === 302 && loc.includes("lp_click_id="), `GET /r/${link.slug} -> 302 with lp_click_id`, `HTTP ${r?.status ?? "error"}`);
  }

  // 4. Webhook.
  const { data: click } = await db.from("click_events").select("id").order("clicked_at", { ascending: false }).limit(1).maybeSingle();
  if (!click) line(false, "a click exists for the webhook test");
  else {
    const secret = optionalEnv("CONVERSION_WEBHOOK_SECRET")!;
    const eventId = `val_${randomBytes(8).toString("hex")}`;
    const body = JSON.stringify({ event_id: eventId, click_id: click.id, type: "signup", occurred_at: new Date().toISOString() });
    const ts = String(Math.floor(Date.now() / 1000));
    const send = (sig: string) =>
      fetch(new URL("/api/conversion", base), { method: "POST", headers: { "Content-Type": "application/json", "X-LinkPulse-Timestamp": ts, "X-LinkPulse-Signature": sig }, body });
    const a = await send(signPayload(secret, ts, body));
    line(a.status === 201, "signed conversion -> 201", `HTTP ${a.status}`);
    const b = await send(signPayload(secret, ts, body));
    const bj = (await b.json().catch(() => ({}))) as { status?: string };
    line(b.status === 200 && bj.status === "duplicate", "duplicate conversion -> 200 duplicate", `HTTP ${b.status}`);
    const c = await send(`sha256=${"f".repeat(64)}`);
    line(c.status === 401, "bad signature -> 401", `HTTP ${c.status}`);
    await db.from("conversions").delete().eq("event_id", eventId);
  }

  // 5. Simulate bot_burst + detect (twice, for idempotency).
  try {
    const sim = await runSimulation(db, { scenario: "bot_burst", baseUrl: base });
    line(sim.events_written > 0, "simulate bot_burst wrote events", `${sim.events_written} clicks on /r/${sim.link_slug}`);
    const detect = () => fetch(new URL("/api/jobs/detect", base), { method: "POST", headers: { Authorization: `Bearer ${cron}` } });
    const d1 = await detect();
    line(d1.status === 200, "detect job (bearer) -> 200", `HTTP ${d1.status}`);
    const { data: l } = await db.from("links").select("id").eq("slug", sim.link_slug).single();
    const { data: alerts } = await db
      .from("alerts")
      .select("id, ai_summary, window_start")
      .eq("link_id", l!.id)
      .eq("rule_code", "IP_BURST")
      .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    const alert = alerts?.[0];
    line(Boolean(alert), "IP_BURST alert created", alert ? "found" : "none");
    line(Boolean(alert?.ai_summary && alert.ai_summary.trim().length > 0), "alert has a non-empty summary (AI or template)");
    const d2 = await detect();
    const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).eq("link_id", l!.id).eq("rule_code", "IP_BURST").eq("window_start", alert?.window_start ?? "1970-01-01");
    line(d2.status === 200 && count === 1, "second detect run creates no duplicate", `HTTP ${d2.status}, ${count} alert(s) for that window`);
  } catch (e) {
    line(false, "simulate + detect", e instanceof Error ? e.message : "error");
  }

  // 6. Eval (small) and security-check, as child processes.
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const ev = spawnSync(npm, ["run", "eval", "--", "--suite", "randomised", "--trials", "5"], { encoding: "utf8", shell: process.platform === "win32" });
  line(ev.status === 0 && existsSync("eval/results/randomised.json"), "npm run eval -- --suite randomised --trials 5", `exit ${ev.status}`);
  const sc = spawnSync(npm, ["run", "security-check"], { encoding: "utf8", shell: process.platform === "win32" });
  let secDetail = `exit ${sc.status}`;
  try {
    const rec = JSON.parse(readFileSync("eval/results/security.json", "utf8")) as { summary: { passed: number; total: number } };
    secDetail = `${rec.summary.passed}/${rec.summary.total} passed`;
  } catch {
    // keep exit detail
  }
  line(sc.status === 0, "security-check", secDetail);

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(`validate failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
