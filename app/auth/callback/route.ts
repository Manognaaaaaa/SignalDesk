import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Landing point of the email confirmation link: exchanges the one-time code for a session
 * cookie, then continues to /today (which sends new users to onboarding). The redirect target
 * is fixed - never taken from the query string - so this cannot be used as an open redirect.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code && code.length < 512) {
    try {
      const sb = await supabaseServer();
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL("/today", url.origin));
    } catch {
      // fall through to login
    }
  }
  return NextResponse.redirect(new URL("/login", url.origin));
}
