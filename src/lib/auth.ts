import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string | null };

/**
 * The current user from the auth cookie. getUser() re-validates the JWT with Supabase Auth
 * (unlike getSession(), which trusts the cookie). Every route derives the user from here -
 * never from a request body. Returns null for anonymous users or on any error.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}
