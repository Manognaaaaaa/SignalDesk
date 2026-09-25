/**
 * npm run simulate -- --scenario bot_burst [--slug ng-summer-promo]
 * Writes one attack to the database (dataset='simulated'), probes the real hot path at
 * APP_BASE_URL, then triggers the detect job over HTTP with the cron bearer secret - exactly
 * the path pg_cron uses - so the alert appears live on the dashboard.
 */
import { runSimulation, scenarioSchema } from "@/lib/simulate/live";
import { adminClient, optionalEnv, parseArgs, requireEnv } from "./lib/env";

async function main() {
  const args = parseArgs();
  const scenario = scenarioSchema.safeParse(args.scenario ?? "bot_burst");
  if (!scenario.success) {
    console.error(`Unknown scenario. Use one of: ${scenarioSchema.options.join(", ")}`);
    process.exit(1);
  }
  const db = adminClient();
  const baseUrl = optionalEnv("APP_BASE_URL");
  const res = await runSimulation(db, {
    scenario: scenario.data,
    slug: typeof args.slug === "string" ? args.slug : undefined,
    baseUrl,
  });
  console.log(`Simulated ${res.scenario} on /r/${res.link_slug}: ${res.events_written} clicks, ${res.conversions_written} conversions`);
  console.log(`Hot path probes: ${res.hot_path_requests.redirected}/${res.hot_path_requests.sent} redirected`);
  await db.from("job_runs").insert({ job: "simulate", finished_at: new Date().toISOString(), status: "ok", stats: res });

  if (!baseUrl) {
    console.log("APP_BASE_URL not set: skipping the detect trigger. Run detection from the dashboard.");
    return;
  }
  const { CRON_SECRET } = requireEnv("CRON_SECRET");
  const det = await fetch(new URL("/api/jobs/detect", baseUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const body = (await det.json().catch(() => ({}))) as { stats?: unknown };
  console.log(`Detect job: HTTP ${det.status}`, body.stats ?? "");
}

main().catch((e) => {
  console.error(`Simulation failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
