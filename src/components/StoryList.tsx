"use client";
import { useCallback, useState } from "react";
import { timeAgo } from "@/lib/format";
import type { StoryGroup } from "@/lib/ui-types";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { StanceBadge } from "./StanceBadge";

/**
 * Stories grouped across outlets ("3 sources covering this"). Each article row opens the
 * Evidence drawer for this asset. `compact` shows only the headline row per story.
 */
export function StoryList({ stories, assetSlug, compact = false }: { stories: StoryGroup[]; assetSlug: string; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  if (stories.length === 0) return <p className="mt-2 text-sm text-faint">No stories in the last 48 hours.</p>;
  return (
    <>
      <ul className="divide-y divide-line/70">
        {stories.map((s) => {
          const lead = s.articles[0]!;
          return (
            <li key={s.story_id} className="py-2.5">
              <button onClick={() => setOpen(lead.id)} className="group/row -mx-2 w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left transition hover:bg-raised">
                <span className="line-clamp-2 text-sm font-medium leading-snug text-fg">{s.headline}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-faint">
                  {lead.status && <StanceBadge stance={lead.stance} strength={lead.strength} failed={lead.status === "failed"} />}
                  <span>{s.source_count > 1 ? `${s.source_count} sources covering this` : lead.source}</span>
                  <span suppressHydrationWarning>· {timeAgo(s.last_at)}</span>
                  <span className="ml-auto text-accent opacity-0 transition group-hover/row:opacity-100" aria-hidden="true">
                    evidence →
                  </span>
                </span>
              </button>
              {!compact && s.articles.length > 1 && (
                <ul className="mt-2 ml-1 space-y-1 border-l border-line pl-3">
                  {s.articles.slice(1).map((a) => (
                    <li key={a.id}>
                      <button onClick={() => setOpen(a.id)} className="flex flex-wrap items-center gap-2 rounded px-1 text-left text-xs text-muted transition hover:text-fg">
                        <span className="font-medium">{a.source}</span>
                        <span className="line-clamp-1">{a.title}</span>
                        {a.status && <StanceBadge stance={a.stance} failed={a.status === "failed"} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <EvidenceDrawer articleId={open} assetSlugs={[assetSlug]} onClose={close} />
    </>
  );
}
