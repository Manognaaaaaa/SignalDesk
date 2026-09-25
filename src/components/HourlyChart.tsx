"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SeriesPoint } from "@/lib/ui-types";

const hourLabel = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`;
};

/** Hourly clicks, bot clicks and signups from link_stats_hourly (refreshed live via Realtime). */
export function HourlyChart({ data, title }: { data: SeriesPoint[]; title: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {data.every((d) => d.clicks === 0) ? (
        <p className="mt-3 text-sm text-slate-500">No clicks in this period yet.</p>
      ) : (
        <div className="mt-2 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="hour" tickFormatter={hourLabel} minTickGap={40} fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip labelFormatter={(v) => hourLabel(String(v))} />
              <Legend />
              <Line type="monotone" dataKey="clicks" name="Clicks" stroke="#4338ca" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="bot_clicks" name="Bot clicks" stroke="#d97706" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="signups" name="Signups" stroke="#059669" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
