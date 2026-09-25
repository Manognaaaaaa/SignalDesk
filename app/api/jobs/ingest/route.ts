import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { authorizeJob } from "@/lib/job-auth";
import { runPipeline } from "@/lib/jobs/run-pipeline";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/jobs/ingest - pg_cron (bearer) or an allowlisted admin session only. */
export async function POST(req: Request) {
  const env = serverEnv();
  const ok = await authorizeJob(req, env.CRON_SECRET, env.ADMIN_EMAILS, async () => (await getSessionUser())?.email ?? null);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runPipeline(supabaseAdmin(), env, { timeBudgetMs: 45_000 });
    return NextResponse.json({ status: "ok", result });
  } catch {
    console.error("[ingest] job failed");
    return NextResponse.json({ error: "job failed" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}
