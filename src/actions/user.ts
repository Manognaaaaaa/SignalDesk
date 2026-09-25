"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * User server actions. The user id ALWAYS comes from the session; writes go through the user's
 * own RLS-scoped client (policies only allow rows where user_id = auth.uid()), and the database
 * trigger caps a watchlist at 20 assets.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const slugSchema = z.string().regex(/^[a-z0-9-]{2,30}$/);
const LIMITS = { onboarding: { min: 3, max: 10 }, watchlist: { min: 1, max: 20 } } as const;

/** Replaces the watchlist with exactly `slugs` (validated against the regex AND the catalogue). */
export async function saveWatchlist(slugs: string[], mode: "onboarding" | "watchlist"): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { min, max } = LIMITS[mode];
  const parsed = z.array(slugSchema).min(min).max(max).safeParse([...new Set(slugs)]);
  if (!parsed.success) return { ok: false, error: `Pick between ${min} and ${max} assets.` };
  try {
    const db = await supabaseServer();
    const { data: assets } = await db.from("assets").select("id, slug").in("slug", parsed.data);
    if (!assets || assets.length !== parsed.data.length) return { ok: false, error: "Unknown asset selected." };
    const wanted = new Set(assets.map((a) => a.id as string));
    const { data: current } = await db.from("watchlists").select("asset_id").eq("user_id", user.id);
    const have = new Set((current ?? []).map((r) => r.asset_id as string));
    const remove = [...have].filter((id) => !wanted.has(id));
    const add = [...wanted].filter((id) => !have.has(id));
    if (remove.length) {
      const { error } = await db.from("watchlists").delete().eq("user_id", user.id).in("asset_id", remove);
      if (error) throw new Error("delete failed");
    }
    if (add.length) {
      const { error } = await db.from("watchlists").insert(add.map((asset_id) => ({ user_id: user.id, asset_id })));
      if (error) throw new Error("insert failed");
    }
    revalidatePath("/today");
    revalidatePath("/watchlist");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save your watchlist. Please try again." };
  }
}

/** Turns beginner mode on or off for the signed-in user. */
export async function setBeginnerMode(on: boolean): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const v = z.boolean().safeParse(on);
  if (!v.success) return { ok: false, error: "Invalid value." };
  try {
    const db = await supabaseServer();
    const { error } = await db.from("user_settings").upsert({ user_id: user.id, beginner_mode: v.data }, { onConflict: "user_id" });
    if (error) throw new Error("save failed");
    revalidatePath("/today");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the setting." };
  }
}
