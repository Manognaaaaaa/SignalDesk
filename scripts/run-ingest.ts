/**
 * npm run ingest [-- --no-score]
 * Runs the same background job the cron triggers, locally with the service role:
 * fetch feeds -> articles -> stories -> asset mentions -> stance scoring -> daily mood.
 * Without GROQ_API_KEY (or with --no-score) stance scoring is skipped; everything else runs.
 */
import { serverEnv } from "@/lib/env";
import { runPipeline } from "@/lib/jobs/run-pipeline";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseArgs } from "./lib/env";

async function main() {
  const args = parseArgs();
  const env = serverEnv();
  const effective = args["no-score"] ? { ...env, GROQ_API_KEY: undefined } : env;
  const res = await runPipeline(supabaseAdmin(), effective, { timeBudgetMs: 10 * 60_000 });
  for (const step of ["ingest", "score", "mood"] as const) console.log(`${step}: ${res[step].status}`, JSON.stringify(res[step].stats));
  console.log(`done in ${(res.duration_ms / 1000).toFixed(1)} s`);
  if ([res.ingest, res.score, res.mood].some((s) => s.status === "failed")) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`ingest failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
