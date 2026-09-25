"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setLinkActive } from "@/actions/admin";
import type { LinkSummary } from "@/lib/ui-types";

/** Links with 24 h activity; admins can activate/deactivate. Copy uses the Clipboard API. */
export function LinksTable({ links, isAdmin, origin }: { links: LinkSummary[]; isAdmin: boolean; origin: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const copy = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(`${origin}/r/${slug}`);
      setCopied(slug);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  const toggle = (l: LinkSummary) =>
    start(async () => {
      setError(null);
      const r = await setLinkActive(l.link_id, !l.is_active);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });

  if (links.length === 0) return <p className="text-sm text-slate-500">No links yet.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      {error && <p className="p-2 text-sm text-red-700">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="p-2">Link</th>
            <th className="p-2">Campaign</th>
            <th className="p-2">Affiliate</th>
            <th className="p-2">Targets</th>
            <th className="p-2 text-right">Clicks 24 h</th>
            <th className="p-2 text-right">Conv. rate</th>
            <th className="p-2 text-right">Open alerts</th>
            <th className="p-2">Status</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {links.map((l) => (
            <tr key={l.link_id} className="border-t border-slate-100">
              <td className="p-2 font-mono text-xs">
                <Link href={`/links/${l.link_id}`} className="text-indigo-700 underline">
                  /r/{l.slug}
                </Link>
                {l.purpose !== "campaign" && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px]">{l.purpose}</span>}
              </td>
              <td className="max-w-48 truncate p-2">{l.campaign_name}</td>
              <td className="p-2">{l.affiliate_name ?? "-"}</td>
              <td className="p-2 text-xs">{l.target_countries.join(", ")}</td>
              <td className="p-2 text-right">{l.clicks_24h.toLocaleString("en-US")}</td>
              <td className="p-2 text-right">{l.clicks_24h > 0 ? `${((l.signups_24h / l.clicks_24h) * 100).toFixed(1)}%` : "-"}</td>
              <td className={`p-2 text-right ${l.open_alerts > 0 ? "font-semibold text-red-700" : ""}`}>{l.open_alerts}</td>
              <td className="p-2 text-xs">{l.is_active ? "active" : "inactive"}</td>
              <td className="space-x-2 whitespace-nowrap p-2 text-xs">
                <button onClick={() => copy(l.slug)} className="rounded border border-slate-300 px-2 py-0.5">
                  {copied === l.slug ? "Copied" : "Copy link"}
                </button>
                {isAdmin && (
                  <button disabled={pending} onClick={() => toggle(l)} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-50">
                    {l.is_active ? "Deactivate" : "Activate"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
