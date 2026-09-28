"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWatchlist } from "@/actions/user";
import { ASSET_TYPE_LABEL } from "@/lib/format";
import type { AssetRow } from "@/lib/ui-types";
import { btnPrimary, field, label } from "./ui";

/**
 * Pick assets from the catalogue, grouped by type with a one-line plain description each.
 * Limits are enforced on the server too (onboarding 3-10, watchlist 1-20).
 */
export function AssetPicker({ assets, initial, mode, min, max, next }: { assets: AssetRow[]; initial: string[]; mode: "onboarding" | "watchlist"; min: number; max: number; next: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const router = useRouter();
  const q = query.trim().toLowerCase();
  const matches = (a: AssetRow) => !q || `${a.name} ${a.slug} ${a.description_simple} ${ASSET_TYPE_LABEL[a.asset_type] ?? ""}`.toLowerCase().includes(q);
  const groups = new Map<string, AssetRow[]>();
  for (const a of assets.filter(matches)) (groups.get(a.asset_type) ?? groups.set(a.asset_type, []).get(a.asset_type)!).push(a);

  const toggle = (slug: string) => {
    setSaved(false);
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(slug)) n.delete(slug);
      else if (n.size < max) n.add(slug);
      return n;
    });
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await saveWatchlist([...picked], mode);
      if (!r.ok) return setError(r.error);
      setSaved(true);
      router.push(next);
      router.refresh();
    });

  const count = picked.size;
  return (
    <div>
      <div className="mt-6">
        <label className="block text-sm text-muted">
          Search {assets.length} assets
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. yen, oil, Nvidia, central bank" className={field} />
        </label>
      </div>
      {groups.size === 0 && <p className="mt-6 text-sm text-muted">No assets match &ldquo;{query}&rdquo;.</p>}
      {[...groups.entries()].map(([type, list]) => (
        <fieldset key={type} className="mt-6">
          <legend className={label}>{ASSET_TYPE_LABEL[type] ?? type}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {list.map((a) => {
              const on = picked.has(a.slug);
              return (
                <label
                  key={a.slug}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                    on ? "border-accent/60 bg-accent/[0.06]" : "border-line bg-surface hover:border-line-strong"
                  } ${!on && count >= max ? "opacity-50" : ""}`}
                >
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]" checked={on} onChange={() => toggle(a.slug)} disabled={!on && count >= max} />
                  <span>
                    <span className="block text-sm font-medium">{a.name}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-faint">{a.description_simple}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="sticky bottom-0 mt-8 flex flex-wrap items-center gap-3 border-t border-line bg-bg/90 py-4 backdrop-blur-md">
        <button
          onClick={submit}
          disabled={pending || count < min}
          className={btnPrimary}
        >
          {pending ? "Saving..." : mode === "onboarding" ? "Build my Today page" : "Save watchlist"}
        </button>
        <span className="tabular text-sm text-muted">
          {count} selected · pick {min === max ? min : `${min} to ${max}`}
        </span>
        {error && <span className="text-sm text-down" role="alert">{error}</span>}
        {saved && !error && <span className="text-sm text-accent">Saved</span>}
      </div>
    </div>
  );
}
