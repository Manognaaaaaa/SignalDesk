"use client";
import { useEffect, useRef, useState } from "react";
import { safeHref, timeAgo } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { SentenceRow } from "@/lib/ui-types";
import { EvidenceSentences } from "./EvidenceSentences";
import { StanceBadge } from "./StanceBadge";
import { btnPrimary, btnQuiet, label } from "./ui";

type Block = { slug: string; name: string; sentences: SentenceRow[]; stance: string | null; strength: number | null; status: string | null; why: string; evidence_ids: string[] };
type Loaded = { title: string; url: string; source: string; at: string; blocks: Block[] };

const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

/**
 * Side sheet (bottom sheet on mobile) showing WHY a claim was made: the article, the stored
 * sentences with evidence highlighted, the stance and its one-line reason, and a link to the
 * original. Reads public tables with the anon key (RLS allows SELECT on news data).
 */
export function EvidenceDrawer({ articleId, assetSlugs, onClose }: { articleId: string | null; assetSlugs?: string[]; onClose: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Stable key: callers often pass a fresh array each render.
  const slugKey = (assetSlugs ?? []).join(",");

  useEffect(() => {
    if (!articleId) return;
    let cancelled = false;
    setData(null);
    setError(false);
    (async () => {
      const db = supabaseBrowser();
      const [art, ms, sigs] = await Promise.all([
        db.from("articles").select("title, url, published_at, fetched_at, sources(name)").eq("id", articleId).maybeSingle(),
        db.from("asset_mentions").select("asset_id, sentences, assets(slug, name)").eq("article_id", articleId),
        db.from("asset_signals").select("asset_id, stance, strength, status, why, evidence_ids").eq("article_id", articleId),
      ]);
      if (cancelled) return;
      if (art.error || !art.data) {
        setError(true);
        return;
      }
      const blocks: Block[] = (ms.data ?? [])
        .map((m) => {
          const asset = one(m.assets as { slug: string; name: string } | { slug: string; name: string }[]);
          const s = (sigs.data ?? []).find((x) => x.asset_id === m.asset_id);
          return {
            slug: asset?.slug ?? "",
            name: asset?.name ?? "Asset",
            sentences: m.sentences as SentenceRow[],
            stance: (s?.stance as string) ?? null,
            strength: (s?.strength as number) ?? null,
            status: (s?.status as string) ?? null,
            why: (s?.why as string) ?? "",
            evidence_ids: (s?.evidence_ids as string[]) ?? [],
          };
        })
        .filter((b) => !slugKey || slugKey.split(",").includes(b.slug));
      const a = art.data as { title: string; url: string; published_at: string | null; fetched_at: string; sources: { name: string } | { name: string }[] | null };
      setData({ title: a.title, url: a.url, source: one(a.sources)?.name ?? "Unknown source", at: a.published_at ?? a.fetched_at, blocks });
    })().catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [articleId, slugKey]);

  useEffect(() => {
    if (!articleId) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [articleId, onClose]);

  if (!articleId) return null;
  const href = data ? safeHref(data.url) : null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
      <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="Close evidence" onClick={onClose} tabIndex={-1} />
      <aside className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line-strong bg-surface p-6 shadow-[0_-24px_60px_-20px_rgb(0_0_0/0.8)] sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[460px] sm:rounded-none sm:border-t-0 sm:border-l">
        <div className="flex items-start justify-between gap-3">
          <p className={`${label} flex items-center gap-2`}>
            <span className="h-1.5 w-1.5 rounded-full bg-mark" aria-hidden="true" />
            Evidence
          </p>
          <button ref={closeRef} onClick={onClose} className={btnQuiet} aria-label="Close">
            ✕
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-muted">This article could not be loaded. Close the panel and try again.</p>}
        {!error && !data && (
          <div className="mt-4 space-y-3" aria-busy="true">
            <div className="h-5 w-3/4 animate-pulse rounded bg-raised" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-raised" />
            <div className="h-20 animate-pulse rounded bg-raised" />
          </div>
        )}
        {data && (
          <>
            <h2 id="evidence-title" className="mt-3 text-lg font-semibold leading-snug tracking-tight">
              {data.title}
            </h2>
            <p className="mt-1.5 text-xs text-faint">
              {data.source} · {timeAgo(data.at)}
            </p>
            {data.blocks.length === 0 && <p className="mt-4 text-sm text-muted">No asset sentences stored for this article.</p>}
            {data.blocks.map((b) => (
              <section key={b.slug} className="mt-6 border-t border-line/70 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{b.name}</h3>
                  {b.status ? <StanceBadge stance={b.stance} strength={b.strength} failed={b.status === "failed"} /> : <span className="text-xs text-faint">AI scoring pending</span>}
                </div>
                {b.why && <p className="mt-1.5 text-sm text-muted">{b.why}</p>}
                <div className="mt-2">
                  <EvidenceSentences sentences={b.sentences} evidenceIds={b.evidence_ids} />
                </div>
              </section>
            ))}
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={`${btnPrimary} mt-6`}>
                Read the original ↗
              </a>
            )}
            <p className="mt-4 text-[11px] text-faint">Only short excerpts are stored. Headlines belong to their publishers.</p>
          </>
        )}
      </aside>
    </div>
  );
}
