"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWatchlist } from "@/actions/user";
import { ASSET_TYPE_LABEL } from "@/lib/format";
import type { AssetRow } from "@/lib/ui-types";

/**
 * Pick assets from the catalogue, grouped by type with a one-line plain description each.
 * Limits are enforced on the server too (onboarding 3-10, watchlist 1-20).
 */
export function AssetPicker({ assets, initial, mode, min, max, next }: { assets: AssetRow[]; initial: string[]; mode: "onboarding" | "watchlist"; min: number; max: number; next: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const groups = new Map<string, AssetRow[]>();
  for (const a of assets) (groups.get(a.asset_type) ?? groups.set(a.asset_type, []).get(a.asset_type)!).push(a);

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
      {[...groups.entries()].map(([type, list]) => (
        <fieldset key={type} className="mt-6">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{ASSET_TYPE_LABEL[type] ?? type}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {list.map((a) => {
              const on = picked.has(a.slug);
              return (
                <label
                  key={a.slug}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                    on ? "border-slate-900 bg-slate-50 dark:border-white dark:bg-slate-800" : "border-slate-200 hover:border-slate-400 dark:border-slate-700"
                  }`}
                >
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-slate-900" checked={on} onChange={() => toggle(a.slug)} disabled={!on && count >= max} />
                  <span>
                    <span className="block text-sm font-medium">{a.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{a.description_simple}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <button
          onClick={submit}
          disabled={pending || count < min}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
        >
          {pending ? "Saving..." : mode === "onboarding" ? "Build my Today page" : "Save watchlist"}
        </button>
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {count} selected · pick {min === max ? min : `${min} to ${max}`}
        </span>
        {error && <span className="text-sm text-rose-700 dark:text-rose-300" role="alert">{error}</span>}
        {saved && !error && <span className="text-sm text-emerald-700 dark:text-emerald-300">Saved</span>}
      </div>
    </div>
  );
}
