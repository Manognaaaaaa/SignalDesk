"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLink } from "@/actions/admin";
import type { AffiliateOption } from "@/lib/ui-types";

/**
 * Admin form to create a campaign link. The browser only collects strings; all validation that
 * matters (slug regex, destination allowlist, ISO countries, admin role) happens on the server.
 */
export function CreateLinkForm({ affiliates, allowedDomains }: { affiliates: AffiliateOption[]; allowedDomains: string[] }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const input = Object.fromEntries(["slug", "campaign_name", "affiliate_id", "destination_url", "target_countries"].map((k) => [k, String(fd.get(k) ?? "")]));
    start(async () => {
      const r = await createLink(input);
      if (r.ok) {
        setMessage({ ok: true, text: "Link created." });
        form.reset();
        router.refresh();
      } else setMessage({ ok: false, text: r.error });
    });
  };

  const field = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
      <h2 className="text-sm font-semibold md:col-span-3">Create link</h2>
      <label className="text-xs">
        Slug
        <input name="slug" required pattern="[a-z0-9-]{3,40}" placeholder="ng-summer-promo" className={field} />
      </label>
      <label className="text-xs">
        Campaign name
        <input name="campaign_name" required minLength={2} maxLength={80} className={field} />
      </label>
      <label className="text-xs">
        Affiliate
        <select name="affiliate_id" required className={field}>
          {affiliates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs md:col-span-2">
        Destination URL (https, allowed: {allowedDomains.join(", ") || "none configured"})
        <input name="destination_url" required type="url" placeholder={`https://${allowedDomains[0] ?? "example.com"}/promo`} className={field} />
      </label>
      <label className="text-xs">
        Target countries (ISO codes)
        <input name="target_countries" required placeholder="NG, KE" className={field} />
      </label>
      <div className="flex items-center gap-3 md:col-span-3">
        <button disabled={pending} className="rounded bg-indigo-700 px-3 py-1 text-sm text-white disabled:opacity-50">
          {pending ? "Creating..." : "Create link"}
        </button>
        {message && <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</span>}
      </div>
    </form>
  );
}
