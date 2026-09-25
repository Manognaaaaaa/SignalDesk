import { serverEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleConversion, type ConversionRow } from "@/lib/webhook/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolves link_id from the click row; the body's claims about the link are never trusted. */
async function findClickLink(clickId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from("click_events").select("link_id").eq("id", clickId).maybeSingle();
  if (error) throw new Error("lookup failed");
  return (data?.link_id as string | undefined) ?? null;
}

/** Idempotent insert: ON CONFLICT (event_id) DO NOTHING; an empty result means duplicate. */
async function insert(row: ConversionRow): Promise<"created" | "duplicate"> {
  const { data, error } = await supabaseAdmin()
    .from("conversions")
    .upsert(row, { onConflict: "event_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error("insert failed");
  return data && data.length > 0 ? "created" : "duplicate";
}

/** POST /api/conversion - HMAC-signed partner webhook. Other methods get 405 automatically. */
export async function POST(req: Request) {
  return handleConversion(req, { secret: serverEnv().CONVERSION_WEBHOOK_SECRET, findClickLink, insert });
}
