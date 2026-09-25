/**
 * npm run security-check
 * Black-box security checks against APP_BASE_URL (local or production). Writes a pass/fail matrix
 * to eval/results/security.json (+ eval_runs when a service-role key is set). Exit code 1 if any fail.
 *
 * Uses: the anon key (as an attacker would), the two seeded affiliate accounts (isolation tests),
 * the webhook secret (to prove duplicates/replays are handled) and the service role only to find
 * a real click id and to clean up the one conversion this script creates.
 */
import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { insertEvalRun, makeRecord, writeResult } from "@/eval/report";
import type { SecurityCheck, SecuritySummary } from "@/eval/types";
import { signPayload } from "@/lib/webhook/hmac";
import { adminClient, requireEnv } from "./lib/env";
import { gitSha } from "./lib/meta";

const checks: SecurityCheck[] = [];
function record(category: string, name: string, pass: boolean, detail: string) {
  checks.push({ category, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  [${category}] ${name} - ${detail}`);
}

async function status(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), ...init });
}

/** Signs in through @supabase/ssr so we get the exact cookies the app expects; returns client + Cookie header. */
async function sessionFor(url: string, anon: string, email: string, password: string) {
  const jar = new Map<string, string>();
  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  return { client: client as unknown as SupabaseClient, cookie, userId: data.user.id };
}

async function main() {
  const env = requireEnv(
    "APP_BASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "CONVERSION_WEBHOOK_SECRET",
    "SEED_ADMIN_EMAIL",
    "SEED_AFFILIATE_PASSWORD",
  );
  const base = env.APP_BASE_URL!;
  const u = (p: string) => new URL(p, base).toString();
  const admin = adminClient();
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

  // --- Open redirect -------------------------------------------------------------------------
  for (const [path, why] of [
    ["/r/security-probe-blocked", "link stored with a non-allowlisted destination"],
    ["/r/%2F%2Fevil.example", "encoded protocol-relative slug"],
    ["/r/UPPER_CASE!", "slug outside the allowed pattern"],
    ["/r/does-not-exist-xyz", "unknown slug"],
  ] as const) {
    const r = await status(u(path)).catch(() => null);
    record("open redirect", why, r?.status === 404 && !r.headers.get("location"), `HTTP ${r?.status ?? "error"}`);
  }

  // --- Webhook -------------------------------------------------------------------------------
  const secret = env.CONVERSION_WEBHOOK_SECRET!;
  const { data: click } = await admin.from("click_events").select("id").order("clicked_at", { ascending: false }).limit(1);
  const clickId = click?.[0]?.id as string | undefined;
  const eventId = `sec_${randomBytes(8).toString("hex")}`;
  const body = JSON.stringify({ event_id: eventId, click_id: clickId ?? "00000000-0000-4000-8000-000000000000", type: "signup", occurred_at: new Date().toISOString() });
  const now = String(Math.floor(Date.now() / 1000));
  const post = (b: string, ts: string, sig: string) =>
    status(u("/api/conversion"), { method: "POST", headers: { "Content-Type": "application/json", "X-LinkPulse-Timestamp": ts, "X-LinkPulse-Signature": sig }, body: b });

  let r = await post(body, now, `sha256=${"0".repeat(64)}`);
  record("webhook", "forged signature rejected", r.status === 401, `HTTP ${r.status}`);
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  r = await post(body, old, signPayload(secret, old, body));
  record("webhook", "replayed old timestamp rejected", r.status === 401, `HTTP ${r.status}`);
  r = await post(body.replace("signup", "ftd"), now, signPayload(secret, now, body));
  record("webhook", "tampered body rejected", r.status === 401, `HTTP ${r.status}`);
  if (clickId) {
    const first = await post(body, now, signPayload(secret, now, body));
    const second = await post(body, now, signPayload(secret, now, body));
    const dup = (await second.json().catch(() => ({}))) as { status?: string };
    record("webhook", "valid delivery created, retry is idempotent", first.status === 201 && second.status === 200 && dup.status === "duplicate", `HTTP ${first.status} then ${second.status} ${dup.status ?? ""}`);
    await admin.from("conversions").delete().eq("event_id", eventId); // clean up our test row
  } else {
    record("webhook", "valid delivery created, retry is idempotent", false, "no click found (run npm run seed)");
  }
  const big = JSON.stringify({ pad: "x".repeat(6000) });
  r = await post(big, now, signPayload(secret, now, big));
  record("webhook", "oversized body rejected", r.status === 413 || r.status === 400, `HTTP ${r.status}`);
  r = await status(u("/api/conversion"));
  record("webhook", "wrong method -> 405", r.status === 405, `HTTP ${r.status}`);

  // --- Detect job ----------------------------------------------------------------------------
  r = await status(u("/api/jobs/detect"), { method: "POST" });
  record("job auth", "detect without bearer -> 401", r.status === 401, `HTTP ${r.status}`);
  r = await status(u("/api/jobs/detect"), { method: "POST", headers: { Authorization: `Bearer ${randomBytes(24).toString("hex")}` } });
  record("job auth", "detect with wrong bearer -> 401", r.status === 401, `HTTP ${r.status}`);
  r = await status(u("/api/jobs/detect"));
  record("job auth", "detect GET -> 405", r.status === 405, `HTTP ${r.status}`);

  // --- RLS: anonymous ------------------------------------------------------------------------
  for (const table of ["click_events", "alerts", "links", "conversions", "profiles", "affiliates", "llm_calls", "job_runs"]) {
    const { data, error } = await anon.from(table).select("*").limit(5);
    record("rls anon", `anon reads 0 rows from ${table}`, (data?.length ?? 0) === 0, error ? `error ${error.code}` : `${data?.length ?? 0} rows`);
  }
  {
    const { error } = await anon.from("alerts").update({ status: "resolved" }).neq("status", "x");
    const { error: e2 } = await anon.from("eval_runs").insert({ kind: "security", config_hash: "x", summary: {}, details: {} });
    record("rls anon", "anon cannot write (alerts update, eval_runs insert)", Boolean(error) && Boolean(e2), `${error?.code ?? "no error"} / ${e2?.code ?? "no error"}`);
  }
  for (const fn of ["rollup_hourly", "get_link_window_stats"] as const) {
    const args = fn === "rollup_hourly" ? { p_since: new Date().toISOString() } : { p_as_of: new Date().toISOString() };
    const { error } = await anon.rpc(fn, args);
    record("privileged functions", `anon cannot execute ${fn}`, Boolean(error), error ? `error ${error.code}` : "EXECUTED");
  }

  // --- Affiliate isolation -------------------------------------------------------------------
  const [local, domain] = env.SEED_ADMIN_EMAIL!.split("@");
  const a = await sessionFor(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, `${local}+aff-ng@${domain}`, env.SEED_AFFILIATE_PASSWORD!);
  const b = await sessionFor(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, `${local}+aff-ke@${domain}`, env.SEED_AFFILIATE_PASSWORD!);
  if (!a || !b) {
    record("rls affiliate", "affiliate sessions", false, "could not sign in the seeded affiliates (run npm run seed)");
  } else {
    const { data: profB } = await admin.from("profiles").select("affiliate_id").eq("user_id", b.userId).single();
    const { data: bLinks } = await admin.from("links").select("id").eq("affiliate_id", profB?.affiliate_id ?? "");
    const bIds = (bLinks ?? []).map((l) => l.id as string);
    const { data: aLinks } = await a.client.from("links").select("id, affiliate_id");
    record("rls affiliate", "affiliate A cannot read B's links", (aLinks ?? []).every((l) => !bIds.includes(l.id)) && bIds.length > 0, `A sees ${aLinks?.length ?? 0} links, 0 of B's ${bIds.length}`);
    const { data: aClicks } = await a.client.from("click_events").select("link_id").in("link_id", bIds).limit(5);
    record("rls affiliate", "affiliate A cannot read B's clicks", (aClicks?.length ?? 0) === 0, `${aClicks?.length ?? 0} rows`);
    const { data: aAlerts } = await a.client.from("alerts").select("id").in("link_id", bIds).limit(5);
    record("rls affiliate", "affiliate A cannot read B's alerts", (aAlerts?.length ?? 0) === 0, `${aAlerts?.length ?? 0} rows`);
    const { data: upd, error: updErr } = await a.client.from("alerts").update({ status: "resolved", resolution: "false_alarm" }).neq("status", "x").select("id");
    record("rls affiliate", "affiliate cannot resolve alerts directly", Boolean(updErr) || (upd?.length ?? 0) === 0, updErr ? `error ${updErr.code}` : `${upd?.length ?? 0} rows changed`);
    const { error: rpcErr } = await a.client.rpc("rollup_hourly", { p_since: new Date().toISOString() });
    record("privileged functions", "authenticated user cannot execute rollup_hourly", Boolean(rpcErr), rpcErr ? `error ${rpcErr.code}` : "EXECUTED");
    const { error: rpcErr2 } = await a.client.rpc("get_link_window_stats", { p_as_of: new Date().toISOString() });
    record("privileged functions", "authenticated user cannot execute get_link_window_stats", Boolean(rpcErr2), rpcErr2 ? `error ${rpcErr2.code}` : "EXECUTED");
    const sim = await status(u("/api/admin/simulate"), { method: "POST", headers: { "Content-Type": "application/json", Cookie: a.cookie }, body: JSON.stringify({ scenario: "bot_burst" }) });
    record("admin actions", "affiliate session cannot call admin simulate", sim.status === 401, `HTTP ${sim.status}`);
    const det = await status(u("/api/jobs/detect"), { method: "POST", headers: { Cookie: a.cookie } });
    record("admin actions", "affiliate session cannot run the detect job", det.status === 401, `HTTP ${det.status}`);
  }

  // --- Response headers ----------------------------------------------------------------------
  const page = await status(u("/evaluation"));
  const h = page.headers;
  const csp = h.get("content-security-policy") ?? "";
  record("headers", "CSP with frame-ancestors 'none' and default-src 'self'", csp.includes("frame-ancestors 'none'") && csp.includes("default-src 'self'"), csp ? "present" : "missing");
  record("headers", "X-Frame-Options DENY", h.get("x-frame-options") === "DENY", h.get("x-frame-options") ?? "missing");
  record("headers", "X-Content-Type-Options nosniff", h.get("x-content-type-options") === "nosniff", h.get("x-content-type-options") ?? "missing");
  record("headers", "Referrer-Policy strict-origin-when-cross-origin", h.get("referrer-policy") === "strict-origin-when-cross-origin", h.get("referrer-policy") ?? "missing");
  record("headers", "Permissions-Policy restricts camera/mic/geolocation", (h.get("permissions-policy") ?? "").includes("camera=()"), h.get("permissions-policy") ?? "missing");
  record("headers", "No X-Powered-By", !h.get("x-powered-by"), h.get("x-powered-by") ?? "absent");

  const passed = checks.filter((c) => c.pass).length;
  const summary: SecuritySummary = { passed, total: checks.length, target_host: new URL(base).hostname };
  console.log(`\n${passed}/${checks.length} security checks passed.`);
  const rec = makeRecord("security", null, gitSha(), summary, { checks });
  console.log(`wrote ${writeResult(rec)}`);
  console.log((await insertEvalRun(admin, rec)) ? "stored eval_runs row" : "eval_runs insert failed");
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`security-check failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
