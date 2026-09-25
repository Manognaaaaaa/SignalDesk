"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** The broadcast payload is untrusted (any anon client can publish), so it is validated and shown as text only. */
const payloadSchema = z.object({
  link_slug: z.string().max(40),
  country_code: z.string().max(2).nullable(),
  is_bot: z.boolean().nullable(),
  at: z.string().max(40),
});
type Tick = z.infer<typeof payloadSchema> & { key: number };

/**
 * Live click ticker. Listens to the throttled Realtime Broadcast channel "clicks" (tiny non-PII
 * payload) instead of publishing click_events itself, which would not scale.
 */
export function ClickTicker() {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    let n = 0;
    const channel = supabaseBrowser()
      .channel("clicks")
      .on("broadcast", { event: "click" }, (msg) => {
        const p = payloadSchema.safeParse(msg.payload);
        if (!p.success) return;
        setTicks((prev) => [{ ...p.data, key: n++ }, ...prev].slice(0, 12));
      })
      .subscribe((s) => setStatus(s === "SUBSCRIBED" ? "live" : s.toLowerCase()));
    return () => {
      void supabaseBrowser().removeChannel(channel);
    };
  }, []);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Live clicks</h2>
        <span className={`text-xs ${status === "live" ? "text-emerald-700" : "text-slate-500"}`}>{status}</span>
      </div>
      {ticks.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Waiting for clicks on campaign links...</p>
      ) : (
        <ul className="mt-2 space-y-1 font-mono text-xs">
          {ticks.map((t) => (
            <li key={t.key} className="flex gap-3">
              <span className="text-slate-400">{new Date(t.at).toLocaleTimeString()}</span>
              <span className="truncate">/r/{t.link_slug}</span>
              <span>{t.country_code ?? "??"}</span>
              {t.is_bot && <span className="rounded bg-amber-100 px-1 text-amber-800">bot</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
