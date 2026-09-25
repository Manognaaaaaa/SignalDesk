import { NextResponse } from "next/server";
import { z } from "zod";
import { generateBrief } from "@/lib/ai/brief";
import { supabaseBriefStore } from "@/lib/ai/brief-store";
import { getSessionUser } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Only `level` is read from the body; anything else (e.g. user_id) is stripped and ignored. */
const bodySchema = z.object({ level: z.enum(["standard", "beginner"]) });

/** POST /api/brief - logged-in users only; the user always comes from the session cookie. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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

  try {
    const res = await generateBrief(supabaseBriefStore(supabaseAdmin()), user.id, parsed.data.level, { hasKey: Boolean(serverEnv().GROQ_API_KEY) });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json(res);
  } catch {
    console.error("[brief] generation failed");
    return NextResponse.json({ error: "Could not build your brief right now." }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}
