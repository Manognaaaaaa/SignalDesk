import { z } from "zod";
import { ISO_COUNTRIES } from "@/lib/countries";
import { isAllowedDestination } from "@/lib/redirect/allowed-destination";

/**
 * Validation for admin mutations, kept free of Next.js/Supabase imports so it is unit-testable.
 * The server actions in app/(app)/actions.ts check the admin role FIRST, then parse with these.
 */

export const alertIdSchema = z.uuid();
export const resolutionSchema = z.enum(["confirmed_fraud", "false_alarm", "inconclusive"]);

/** Create-link form: slug regex, name length, allowlisted https destination, real ISO countries. */
export function createLinkSchema(allowedDomains: readonly string[]) {
  return z
    .object({
      slug: z.string().trim().regex(/^[a-z0-9-]{3,40}$/, "3-40 lowercase letters, digits or dashes"),
      campaign_name: z.string().trim().min(2).max(80),
      affiliate_id: z.uuid(),
      destination_url: z
        .string()
        .trim()
        .refine((u) => isAllowedDestination(u, allowedDomains), "destination must be https on an allowed domain"),
      target_countries: z
        .string()
        .transform((s) => [...new Set(s.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))])
        .pipe(z.array(z.string().refine((c) => ISO_COUNTRIES.has(c), "unknown country code")).min(1).max(20)),
    })
    .strict();
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Runs an admin-only mutation: `isAdmin` is checked before `run` is even considered, and any
 * thrown error becomes a generic message (no DB errors or stack traces reach the client).
 */
export async function guardedAdminAction(isAdmin: () => Promise<boolean>, run: () => Promise<ActionResult>): Promise<ActionResult> {
  let admin = false;
  try {
    admin = await isAdmin();
  } catch {
    admin = false;
  }
  if (!admin) return { ok: false, error: "Not allowed." };
  try {
    return await run();
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
