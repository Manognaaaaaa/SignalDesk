import type { Kpis } from "@/lib/ui-types";

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : "-");

/** Five headline numbers for the last 24 hours (RLS-scoped to what the viewer may see). */
export function KpiTiles({ kpis }: { kpis: Kpis }) {
  const tiles = [
    { label: "Clicks (24 h)", value: fmt(kpis.clicks_24h) },
    { label: "Unique visitors (24 h)", value: fmt(kpis.unique_visitors_24h), hint: "distinct daily-rotating IP hashes" },
    { label: "Bot share", value: pct(kpis.bot_clicks_24h, kpis.clicks_24h) },
    { label: "Conversion rate", value: pct(kpis.signups_24h, kpis.clicks_24h), hint: "signups / clicks" },
    { label: "Open alerts", value: fmt(kpis.open_alerts), alert: kpis.open_alerts > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">{t.label}</div>
          <div className={`mt-1 text-2xl font-semibold ${t.alert ? "text-red-700" : ""}`}>{t.value}</div>
          {t.hint && <div className="mt-1 text-[11px] text-slate-400">{t.hint}</div>}
        </div>
      ))}
    </div>
  );
}
