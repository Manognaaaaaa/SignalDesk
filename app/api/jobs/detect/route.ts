import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runDetection } from "@/lib/detection/run-detection";
import { serverEnv } from "@/lib/env";
import { authorizeJob } from "@/lib/job-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/jobs/detect - cron (bearer) or admin session only. Other methods: 405. */
export async function POST(req: Request) {
  const env = serverEnv();
  const ok = await authorizeJob(req, env.CRON_SECRET, async () => (await requireAdmin()) !== null);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const stats = await runDetection(supabaseAdmin(), { maxExplanations: env.MAX_EXPLANATIONS_PER_RUN });
    return NextResponse.json({ status: "ok", stats });
  } catch {
    return NextResponse.json({ error: "detection failed" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}
