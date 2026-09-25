import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AlertsFeed } from "@/components/AlertsFeed";
import { HourlyChart } from "@/components/HourlyChart";
import { RealtimeRefresher } from "@/components/RealtimeRefresher";
import { getSessionUser } from "@/lib/auth";
import { getAlerts, getHourlySeries, getLink } from "@/lib/dashboard-data";

export const metadata = { title: "Link - LinkPulse" };

/** One link: 7-day hourly chart and full alert history. Unknown or not-visible ids -> 404. */
export default async function LinkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const link = await getLink(id);
  if (!link) notFound(); // also the result when RLS hides another affiliate's link
  const user = await getSessionUser();
  const [series, alerts] = await Promise.all([getHourlySeries(168, true, id), getAlerts({ includeReplay: true, linkId: id, limit: 200 })]);
  const aff = (Array.isArray(link.affiliates) ? link.affiliates[0] : link.affiliates) as { name: string; tier: string | null } | null;

  return (
    <div className="space-y-4">
      <Link href="/links" className="text-xs text-indigo-700 underline">
        Back to links
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-semibold">/r/{link.slug}</h1>
        <RealtimeRefresher />
      </div>
      <dl className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Campaign</dt>
          <dd>{link.campaign_name}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Affiliate</dt>
          <dd>
            {aff?.name ?? "-"} {aff?.tier ? `(${aff.tier})` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Targets</dt>
          <dd>{(link.target_countries as string[]).join(", ") || "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Status</dt>
          <dd>
            {link.is_active ? "active" : "inactive"} · {link.purpose}
          </dd>
        </div>
        <div className="col-span-2 md:col-span-4">
          <dt className="text-xs text-slate-500">Destination</dt>
          <dd className="break-all font-mono text-xs">{link.destination_url}</dd>
        </div>
      </dl>
      <HourlyChart data={series} title="Last 7 days (hourly)" />
      <AlertsFeed alerts={alerts} isAdmin={user?.role === "admin"} title="Alert history" />
    </div>
  );
}
