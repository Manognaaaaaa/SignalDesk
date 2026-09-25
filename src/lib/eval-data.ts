import "server-only";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { EvalKind, EvalRecord } from "@/eval/types";

/**
 * Loads the latest evaluation result per kind for the PUBLIC /evaluation page.
 * Uses the ANON key only (eval_runs is the one anon-readable table: aggregates, no PII/secrets).
 * If Supabase is not configured or empty, falls back to local eval/results files (dev), and
 * otherwise returns nothing so the page shows "no results yet".
 */

const KINDS: EvalKind[] = ["randomised", "false_alarm", "sensitivity", "held_out", "replay", "load_test", "security"];

export type EvalResults = { source: "database" | "local files" | "none"; records: Partial<Record<EvalKind, EvalRecord>> };

async function fromDatabase(): Promise<Partial<Record<EvalKind, EvalRecord>>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return {};
  const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const out: Partial<Record<EvalKind, EvalRecord>> = {};
  await Promise.all(
    KINDS.map(async (kind) => {
      const { data, error } = await db
        .from("eval_runs")
        .select("kind, created_at, git_sha, config_hash, seed, summary, details")
        .eq("kind", kind)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!error && data?.[0]) out[kind] = data[0] as EvalRecord;
    }),
  );
  return out;
}

function fromLocalFiles(): Partial<Record<EvalKind, EvalRecord>> {
  const dir = join(process.cwd(), "eval", "results");
  const out: Partial<Record<EvalKind, EvalRecord>> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as EvalRecord;
      if (KINDS.includes(rec.kind)) out[rec.kind] = rec;
    } catch {
      // ignore
    }
  }
  return out;
}

export async function loadEvalResults(): Promise<EvalResults> {
  try {
    const db = await fromDatabase();
    if (Object.keys(db).length > 0) return { source: "database", records: db };
  } catch {
    // fall through to local files
  }
  const local = fromLocalFiles();
  if (Object.keys(local).length > 0) return { source: "local files", records: local };
  return { source: "none", records: {} };
}
