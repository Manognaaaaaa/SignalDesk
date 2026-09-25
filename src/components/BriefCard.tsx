"use client";
import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";
import { Disclaimer } from "./Disclaimer";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { SourceChip } from "./SourceChip";

export type BriefPayload = {
  source: "ai" | "template";
  cached: boolean;
  bullets: { text: string; asset_slugs: string[]; article_ids: string[] }[];
  articles: { id: string; title: string; source: string; url: string; published_at: string | null }[];
};

/**
 * Today's brief. Rendered from the cached brief when the server already has one; otherwise it
 * asks POST /api/brief once (the server builds it from precomputed signals). Every bullet shows
 * its citations as chips that open the Evidence drawer.
 */
export function BriefCard({ level, initial, aiOnline }: { level: "standard" | "beginner"; initial: BriefPayload | null; aiOnline: boolean }) {
  const [brief, setBrief] = useState<BriefPayload | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; slugs: string[] } | null>(null);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    fetch("/api/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level }) })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as BriefPayload & { error?: string };
        if (cancelled) return;
        if (!r.ok) setError(body.error ?? "Could not build your brief right now.");
        else setBrief(body);
      })
      .catch(() => !cancelled && setError("Could not build your brief right now."));
    return () => {
      cancelled = true;
    };
  }, [initial, level]);

  const byId = new Map((brief?.articles ?? []).map((a) => [a.id, a]));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Your brief{level === "beginner" ? " · plain language" : ""}</h2>
        {brief && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {brief.source === "ai" ? "AI-written, every line cited" : aiOnline ? "Summary from mood data" : "AI offline · summary from mood data"}
          </span>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{error}</p>}
      {!error && !brief && (
        <div className="mt-4 space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" style={{ width: `${90 - i * 12}%` }} />
          ))}
        </div>
      )}
      {brief && (
        <ul className="mt-3 space-y-3">
          {brief.bullets.map((b, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
              <div>
                <p className="text-[15px] leading-relaxed">{b.text}</p>
                {b.article_ids.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {b.article_ids.map((id) => {
                      const a = byId.get(id);
                      return <SourceChip key={id} label={a ? `${a.source} · ${timeAgo(a.published_at)}` : "Source"} onOpen={() => setOpen({ id, slugs: b.asset_slugs })} />;
                    })}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Disclaimer className="mt-4" />
      <EvidenceDrawer articleId={open?.id ?? null} assetSlugs={open?.slugs} onClose={close} />
    </section>
  );
}
