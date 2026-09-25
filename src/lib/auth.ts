import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type SessionUser = { userId: string; email: string | null; role: "admin" | "affiliate"; affiliateId: string | null };

/**
 * Resolves the current user from the auth cookie and loads their role SERVER-SIDE from profiles.
 * getUser() re-validates the JWT with Supabase Auth (unlike getSession(), which trusts the cookie).
 * Returns null for anonymous users or users without a profile.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const { data: profile } = await supabaseAdmin()
      .from("profiles")
      .select("role, affiliate_id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (!profile || (profile.role !== "admin" && profile.role !== "affiliate")) return null;
    return { userId: data.user.id, email: data.user.email ?? null, role: profile.role, affiliateId: profile.affiliate_id };
  } catch {
    return null;
  }
}

/** Returns the user only if they are an admin. Every admin route/action calls this first. */
export async function requireAdmin(): Promise<SessionUser | null> {
  const u = await getSessionUser();
  return u && u.role === "admin" ? u : null;
}
