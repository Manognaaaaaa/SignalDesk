/**
 * npm run send-conversion -- --click <click_id> [--type ftd --amount 50] [--event evt_123...]
 * Partner integration example: signs a conversion exactly as an ad network would and POSTs it.
 *   signature = "sha256=" + HMAC_SHA256(CONVERSION_WEBHOOK_SECRET, `${timestamp}.${rawBody}`)
 * If --click is omitted, the most recent live click is used (service role lookup).
 */
import { randomBytes } from "node:crypto";
import { signPayload } from "@/lib/webhook/hmac";
import { adminClient, parseArgs, requireEnv } from "./lib/env";

async function main() {
  const env = requireEnv("CONVERSION_WEBHOOK_SECRET", "APP_BASE_URL");
  const args = parseArgs();
  let clickId = typeof args.click === "string" ? args.click : undefined;
  if (!clickId) {
    const { data } = await adminClient().from("click_events").select("id").order("clicked_at", { ascending: false }).limit(1);
    clickId = data?.[0]?.id as string | undefined;
    if (!clickId) throw new Error("no clicks found; pass --click <uuid>");
  }
  const type = args.type === "ftd" ? "ftd" : "signup";
  const payload: Record<string, unknown> = {
    event_id: typeof args.event === "string" ? args.event : `evt_${randomBytes(8).toString("hex")}`,
    click_id: clickId,
    type,
    occurred_at: new Date().toISOString(),
  };
  if (type === "ftd") payload.amount_usd = Number(args.amount ?? 50);

  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(new URL("/api/conversion", env.APP_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LinkPulse-Timestamp": ts,
      "X-LinkPulse-Signature": signPayload(env.CONVERSION_WEBHOOK_SECRET!, ts, raw),
    },
    body: raw,
  });
  console.log(`HTTP ${res.status}`, await res.text());
}

main().catch((e) => {
  console.error(`send-conversion failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
