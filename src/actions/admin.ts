"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { alertIdSchema, createLinkSchema, guardedAdminAction, resolutionSchema, type ActionResult } from "@/lib/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { runDetection } from "@/lib/detection/run-detection";
import { serverEnv } from "@/lib/env";
import { linkCache } from "@/lib/redirect/link-cache";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Admin server actions. Each one re-checks the role server-side from the session (the UI hiding
 * a button is not security), validates input with zod, and writes with the service role.
 * Clients only ever get generic error messages.
 */

const isAdmin = async () => (await requireAdmin()) !== null;

/** Marks an open alert as acknowledged. */
export async function acknowledgeAlert(alertId: string): Promise<ActionResult> {
  return guardedAdminAction(isAdmin, async () => {
    const id = alertIdSchema.parse(alertId);
    const { error } = await supabaseAdmin().from("alerts").update({ status: "acknowledged" }).eq("id", id).eq("status", "open");
    if (error) throw new Error("update failed");
    return { ok: true };
  });
}

/** Resolves an alert with the admin's verdict: the human-feedback label for future models. */
export async function resolveAlert(alertId: string, resolution: string): Promise<ActionResult> {
  return guardedAdminAction(isAdmin, async () => {
    const id = alertIdSchema.parse(alertId);
    const r = resolutionSchema.parse(resolution);
    const { error } = await supabaseAdmin().from("alerts").update({ status: "resolved", resolution: r }).eq("id", id);
    if (error) throw new Error("update failed");
    return { ok: true };
  });
}

/** Creates a campaign link after validating slug, name, destination allowlist and countries. */
export async function createLink(input: Record<string, string>): Promise<ActionResult> {
  return guardedAdminAction(isAdmin, async () => {
    const parsed = createLinkSchema(serverEnv().ALLOWED_DESTINATION_DOMAINS).safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, error: `Invalid ${first?.path.join(".") || "input"}: ${first?.message ?? "check the form"}` };
    }
    const { error } = await supabaseAdmin()
      .from("links")
      .insert({ ...parsed.data, purpose: "campaign", is_active: true });
    if (error) return { ok: false, error: error.code === "23505" ? "That slug is already taken." : "Could not create the link." };
    revalidatePath("/links");
    return { ok: true };
  });
}

/** Activates or deactivates a link; clears the redirect cache entry so it applies quickly. */
export async function setLinkActive(linkId: string, active: boolean): Promise<ActionResult> {
  return guardedAdminAction(isAdmin, async () => {
    const id = z.uuid().parse(linkId);
    const { error } = await supabaseAdmin().from("links").update({ is_active: z.boolean().parse(active) }).eq("id", id);
    if (error) throw new Error("update failed");
    linkCache.clear(); // this instance; others expire within the 60 s TTL
    revalidatePath("/links");
    return { ok: true };
  });
}

/** Runs the detection job immediately (same code path as the cron trigger). */
export async function runDetectionNow(): Promise<ActionResult & { inserted?: number }> {
  let inserted = 0;
  const res = await guardedAdminAction(isAdmin, async () => {
    const stats = await runDetection(supabaseAdmin(), { maxExplanations: serverEnv().MAX_EXPLANATIONS_PER_RUN });
    inserted = stats.inserted;
    return { ok: true };
  });
  return res.ok ? { ok: true, inserted } : res;
}
