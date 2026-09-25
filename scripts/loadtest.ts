/**
 * npm run loadtest -- [--url https://your-app.vercel.app] [--connections 20] [--duration 30]
 * Hammers GET /r/loadtest-probe with autocannon WITHOUT following redirects and reports req/s,
 * p50/p95/p99 latency (computed from every response), non-302 responses and errors.
 * The loadtest link has purpose='loadtest', so its clicks are excluded from business metrics and
 * detection. Refuses any host not in LOADTEST_ALLOWED_HOSTS.
 */
import autocannon from "autocannon";
import { z } from "zod";
import { insertEvalRun, makeRecord, writeResult } from "@/eval/report";
import { percentile, round } from "@/eval/metrics";
import type { LoadTestSummary } from "@/eval/types";
import { isLoadtestTargetAllowed } from "@/lib/loadtest-guard";
import { optionalEnv, parseArgs } from "./lib/env";
import { gitSha, optionalAdminClient } from "./lib/meta";

const argsSchema = z.object({
  url: z.url(),
  connections: z.coerce.number().int().min(1).max(200).default(20),
  duration: z.coerce.number().int().min(1).max(300).default(30),
});

async function main() {
  const raw = parseArgs();
  const parsed = argsSchema.safeParse({ url: raw.url ?? optionalEnv("APP_BASE_URL"), connections: raw.connections, duration: raw.duration });
  if (!parsed.success) {
    console.error("Provide --url or APP_BASE_URL (and valid --connections/--duration).");
    process.exit(2);
  }
  const { url, connections, duration } = parsed.data;
  if (!isLoadtestTargetAllowed(url, optionalEnv("LOADTEST_ALLOWED_HOSTS"))) {
    console.error(`Refusing to load test ${new URL(url).hostname}: not listed in LOADTEST_ALLOWED_HOSTS.`);
    process.exit(2);
  }
  const target = new URL("/r/loadtest-probe", url).toString();
  console.log(`Load testing ${target} with ${connections} connections for ${duration} s (redirects not followed)...`);

  const latencies: number[] = [];
  let non302 = 0;
  const result = await new Promise<autocannon.Result>((resolve, reject) => {
    const instance = autocannon({ url: target, connections, duration, headers: { "user-agent": "linkpulse-loadtest/1.0" } }, (err, res) =>
      err ? reject(err) : resolve(res),
    );
    instance.on("response", (_client, statusCode, _bytes, responseTime) => {
      latencies.push(responseTime);
      if (statusCode !== 302) non302++;
    });
  });

  const summary: LoadTestSummary = {
    url_host: new URL(url).hostname,
    connections,
    duration_s: duration,
    requests: latencies.length,
    requests_per_sec: round(latencies.length / duration, 1),
    p50_ms: latencies.length ? round(percentile(latencies, 50)!, 1) : null,
    p95_ms: latencies.length ? round(percentile(latencies, 95)!, 1) : null,
    p99_ms: latencies.length ? round(percentile(latencies, 99)!, 1) : null,
    non_302: non302,
    errors: result.errors + result.timeouts,
  };
  console.table(summary);
  const rec = makeRecord("load_test", null, gitSha(), summary, { autocannon: { latency: result.latency, requests: result.requests, errors: result.errors, timeouts: result.timeouts } });
  console.log(`wrote ${writeResult(rec)}`);
  const db = optionalAdminClient();
  if (db) console.log((await insertEvalRun(db, rec)) ? "stored eval_runs row" : "eval_runs insert failed");
  if (summary.non_302 > 0 || summary.errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`loadtest failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
