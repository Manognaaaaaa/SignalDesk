/**
 * npm run eval -- [--suite all|randomised|false_alarm|sensitivity|held_out|replay] [--seed 1234] [--trials 50] [--write-readme]
 *
 * Runs the evaluation harness ENTIRELY IN MEMORY with the production rules (engine.evaluate over
 * StatsTimeline). Needs no API keys. Each suite writes eval/results/<kind>.json and, when
 * SUPABASE_SERVICE_ROLE_KEY is set, an eval_runs row (config_hash, seed, git_sha).
 * One failing suite never stops the others; the exit code is non-zero if any suite failed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { insertEvalRun, makeRecord, readResults, renderResultsMarkdown, replaceBetweenMarkers, writeResult } from "@/eval/report";
import { runFalseAlarm } from "@/eval/suites/false-alarm";
import { runHeldOut } from "@/eval/suites/held-out";
import { runRandomised } from "@/eval/suites/randomised";
import { runReplay } from "@/eval/suites/replay";
import { runSensitivity } from "@/eval/suites/sensitivity";
import type { EvalKind } from "@/eval/types";
import { optionalEnv, parseArgs } from "./lib/env";
import { gitSha, optionalAdminClient } from "./lib/meta";

const SUITES = ["randomised", "false_alarm", "sensitivity", "held_out", "replay"] as const;
const argsSchema = z.object({
  suite: z.enum(["all", ...SUITES]).default("all"),
  seed: z.coerce.number().int().min(0).max(2 ** 31 - 1).default(1234),
  trials: z.coerce.number().int().min(1).max(500).default(50),
});

async function main() {
  const raw = parseArgs();
  const parsed = argsSchema.safeParse({ suite: raw.suite, seed: raw.seed, trials: raw.trials });
  if (!parsed.success) {
    console.error(`Invalid arguments: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    process.exit(2);
  }
  const { suite, seed, trials } = parsed.data;
  const sha = gitSha();
  const db = optionalAdminClient();
  const log = (m: string) => console.log(`  ${m}`);
  const selected = suite === "all" ? SUITES : [suite];
  let failed = 0;

  for (const s of selected) {
    const started = Date.now();
    console.log(`> ${s}`);
    try {
      let rec;
      if (s === "randomised") {
        const r = runRandomised({ seed, trials, onProgress: log });
        rec = makeRecord("randomised", seed, sha, r.summary, r.details);
      } else if (s === "false_alarm") {
        const r = runFalseAlarm({ seed, onProgress: log });
        rec = makeRecord("false_alarm", seed, sha, r.summary, r.details);
      } else if (s === "sensitivity") {
        const r = runSensitivity({ seed, trials: Math.min(trials, 20), onProgress: log });
        rec = makeRecord("sensitivity", seed, sha, r.summary, r.details);
      } else if (s === "held_out") {
        const r = runHeldOut({ seed, trials: Math.min(trials, 30), onProgress: log });
        rec = makeRecord("held_out", seed, sha, r.summary, r.details);
      } else {
        const salt = optionalEnv("IP_HASH_SALT") ?? "linkpulse-eval-local";
        const maxRows = Number(optionalEnv("REPLAY_MAX_ROWS") ?? 200_000);
        const r = await runReplay({ salt, maxRows, onProgress: log });
        if (r.summary.skipped) {
          console.log(r.summary.message);
        }
        rec = makeRecord("replay" as EvalKind, null, sha, r.summary, r.details);
        if (r.summary.skipped) {
          writeResult(rec);
          continue; // a skipped replay is not stored in eval_runs
        }
      }
      const path = writeResult(rec);
      const stored = db ? await insertEvalRun(db, rec) : false;
      console.log(`  wrote ${path}${db ? (stored ? " + eval_runs row" : " (eval_runs insert FAILED)") : ""} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (e) {
      failed++;
      console.error(`  ${s} failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  if (raw["write-readme"]) {
    const readme = readFileSync("README.md", "utf8");
    writeFileSync("README.md", replaceBetweenMarkers(readme, renderResultsMarkdown(readResults())));
    console.log("README results section updated.");
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(`eval failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
