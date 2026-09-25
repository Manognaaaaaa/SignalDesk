import { after } from "next/server";
import { serverEnv } from "@/lib/env";
import { handleRedirect } from "@/lib/redirect/handler";
import { lookupLink, type CachedLink } from "@/lib/redirect/link-cache";
import { logClick } from "@/lib/redirect/log-click";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DB fallback for the link cache: only active links, only the columns the redirect needs. */
async function fetchLink(slug: string): Promise<CachedLink | null> {
  const { data, error } = await supabaseAdmin()
    .from("links")
    .select("id, slug, destination_url, purpose")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error("link lookup failed");
  return data as CachedLink | null;
}

/** GET /r/[slug] - tracking redirect. Other methods get 405 automatically. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleRedirect(req, slug, {
    allowedDomains: serverEnv().ALLOWED_DESTINATION_DOMAINS,
    findLink: (s) => lookupLink(s, fetchLink),
    schedule: (task) => after(task),
    logClick,
  });
}
