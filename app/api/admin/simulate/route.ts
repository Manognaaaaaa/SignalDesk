import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { runDetection } from "@/lib/detection/run-detection";
import { serverEnv } from "@/lib/env";
import { SlidingWindowLimiter } from "@/lib/rate-limit";
import { runSimulation, scenarioSchema } from "@/lib/simulate/live";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Max 3 simulations per admin per 10 minutes (per instance; see README "Known limitations"). */
const limiter = new SlidingWindowLimiter(3, 10 * 60_000);

const bodySchema = z
  .object({ scenario: scenarioSchema, slug: z.string().regex(/^[a-z0-9-]{3,40}$/).optional() })
  .strict();

/**
 * POST /api/admin/simulate - admin only. Writes one simulated attack (<= 2,000 events), probes the
 * hot path, then runs the real detection job so the alert appears live on the dashboard.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!limiter.allow(admin.userId)) return NextResponse.json({ error: "rate limited, try again later" }, { status: 429 });

  const raw = await req.text().catch(() => "");
  if (raw.length > 1024) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const env = serverEnv();
  const db = supabaseAdmin();
  const startedAt = new Date().toISOString();
  try {
    const sim = await runSimulation(db, {
      scenario: parsed.data.scenario,
      slug: parsed.data.slug,
      baseUrl: env.APP_BASE_URL ?? new URL(req.url).origin,
    });
    await db.from("job_runs").insert({ job: "simulate", started_at: startedAt, finished_at: new Date().toISOString(), status: "ok", stats: sim });
    const detection = await runDetection(db, { maxExplanations: env.MAX_EXPLANATIONS_PER_RUN });
    return NextResponse.json({ status: "ok", simulation: sim, detection });
  } catch {
    console.error("[simulate] failed");
    return NextResponse.json({ error: "simulation failed" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}
