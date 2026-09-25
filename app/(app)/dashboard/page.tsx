import Link from "next/link";
import { AlertsFeed } from "@/components/AlertsFeed";
import { ClickTicker } from "@/components/ClickTicker";
import { HourlyChart } from "@/components/HourlyChart";
import { KpiTiles } from "@/components/KpiTiles";
import { RealtimeRefresher } from "@/components/RealtimeRefresher";
import { SimulatePanel } from "@/components/SimulatePanel";
import { getSessionUser } from "@/lib/auth";
import { getAlerts, getHourlySeries, getKpis } from "@/lib/dashboard-data";

export const metadata = { title: "Dashboard - LinkPulse" };

/**
 * Dashboard: KPIs, live click ticker, 48 h hourly chart and the alerts feed.
 * Campaign links only by default; ?replay=1 includes TalkingData replay links. Loadtest links
 * are never shown. Realtime changes trigger a server re-render, so data always passes RLS.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const includeReplay = sp.replay === "1";
  const user = await getSessionUser();
  const isAdmin = user?.role === "admin";
  const [kpis, series, alerts] = await Promise.all([
    getKpis(includeReplay),
    getHourlySeries(48, includeReplay),
    getAlerts({ includeReplay }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <RealtimeRefresher />
        <div className="ml-auto flex gap-1 text-xs">
          <Link href="/dashboard" className={`rounded px-2 py-1 ${!includeReplay ? "bg-slate-800 text-white" : "border border-slate-300"}`}>
            Campaign links
          </Link>
          <Link href="/dashboard?replay=1" className={`rounded px-2 py-1 ${includeReplay ? "bg-slate-800 text-white" : "border border-slate-300"}`}>
            Include replay
          </Link>
        </div>
      </div>
      <KpiTiles kpis={kpis} />
      {isAdmin && <SimulatePanel />}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HourlyChart data={series} title="Last 48 hours (hourly)" />
        </div>
        <ClickTicker />
      </div>
      <AlertsFeed alerts={alerts} isAdmin={isAdmin} />
    </div>
  );
}
