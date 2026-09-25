import { conversionSchema } from "./conversion-schema";
import { verifyWebhook } from "./hmac";

export const MAX_BODY_BYTES = 4096;

export type ConversionRow = {
  event_id: string;
  click_id: string;
  link_id: string;
  type: "signup" | "ftd";
  amount_usd: number | null;
  occurred_at: string;
};

export type ConversionDeps = {
  secret: string;
  /** Resolves the link that owns a click; null if the click does not exist. */
  findClickLink: (clickId: string) => Promise<string | null>;
  /** Inserts with ON CONFLICT (event_id) DO NOTHING; returns whether a row was created. */
  insert: (row: ConversionRow) => Promise<"created" | "duplicate">;
  now?: () => number;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/**
 * POST /api/conversion. Order matters for security:
 *  1. size limit before reading/parsing anything,
 *  2. read the RAW body and verify the HMAC over exactly those bytes (+ timestamp window),
 *  3. only then parse JSON and validate with zod,
 *  4. resolve link_id from click_id server-side, 5. idempotent insert keyed by event_id.
 * Clients only ever see short generic messages.
 */
export async function handleConversion(req: Request, deps: ConversionDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "payload too large" });

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json(400, { error: "bad request" });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return json(413, { error: "payload too large" });

  const v = verifyWebhook(
    deps.secret,
    raw,
    req.headers.get("x-linkpulse-timestamp"),
    req.headers.get("x-linkpulse-signature"),
    now(),
  );
  if (!v.ok) return json(401, { error: "unauthorized" });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad request" });
  }
  const parsed = conversionSchema(now).safeParse(parsedJson);
  if (!parsed.success) return json(400, { error: "invalid body" });
  const body = parsed.data;

  try {
    const linkId = await deps.findClickLink(body.click_id);
    if (!linkId) return json(422, { error: "unknown click" });
    const status = await deps.insert({
      event_id: body.event_id,
      click_id: body.click_id,
      link_id: linkId,
      type: body.type,
      amount_usd: body.amount_usd ?? null,
      occurred_at: new Date(body.occurred_at).toISOString(),
    });
    return status === "created" ? json(201, { status: "created" }) : json(200, { status: "duplicate" });
  } catch {
    console.error("[conversion] storage failed");
    return json(500, { error: "internal error" });
  }
}
