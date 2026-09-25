import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Protects the authenticated app pages and refreshes the Supabase session cookie.
 * Deliberately NOT applied to /r/* (hot path must stay fast), /api/* (routes do their own auth),
 * /evaluation (public) or /login. This is only a UX gate: every page, route and server action
 * re-checks the user server-side, and RLS limits what any session can read.
 */
export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const toLogin = () => {
    const u = req.nextUrl.clone();
    u.pathname = "/login";
    u.search = "";
    return NextResponse.redirect(u);
  };
  if (!url || !anon) return toLogin();

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of toSet) res.cookies.set(name, value, options);
      },
    },
  });
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return toLogin();
  } catch {
    return toLogin();
  }
  return res;
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/links/:path*", "/system/:path*"],
};
