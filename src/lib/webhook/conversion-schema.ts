import { z } from "zod";

const DAY = 86_400_000;

/**
 * Conversion webhook body. link_id is intentionally absent: it is resolved server-side from
 * click_id so a partner cannot attribute a conversion to an arbitrary link.
 */
export function conversionSchema(now: () => number = Date.now) {
  return z
    .object({
      event_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
      click_id: z.uuid(),
      type: z.enum(["signup", "ftd"]),
      amount_usd: z.number().finite().min(0).max(1_000_000).optional(),
      occurred_at: z.iso.datetime({ offset: true }),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (v.type === "ftd" && v.amount_usd === undefined) {
        ctx.addIssue({ code: "custom", path: ["amount_usd"], message: "required for ftd" });
      }
      const t = Date.parse(v.occurred_at);
      if (t > now() + 5 * 60_000) ctx.addIssue({ code: "custom", path: ["occurred_at"], message: "in the future" });
      if (t < now() - 30 * DAY) ctx.addIssue({ code: "custom", path: ["occurred_at"], message: "too old" });
    });
}

export type ConversionBody = z.infer<ReturnType<typeof conversionSchema>>;
