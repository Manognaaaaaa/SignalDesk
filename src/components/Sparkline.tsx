"use client";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { MoodPoint } from "@/lib/ui-types";

/**
 * 7-day mood sparkline (-1..+1, zero line dashed). One series, so no legend: the card title names
 * it. Days without scored news are gaps, not zeros. Hover shows the exact day, score and confidence.
 */
export function Sparkline({ points, height = 44, label }: { points: MoodPoint[]; height?: number; label: string }) {
  const data = points.map((p) => ({ ...p, v: p.score }));
  const has = points.some((p) => p.score !== null);
  if (!has) return <div className="flex items-center text-xs text-slate-500 dark:text-slate-400" style={{ height }}>No mood history yet</div>;
  return (
    <div style={{ height }} role="img" aria-label={`${label}: 7-day mood trend`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis domain={[-1, 1]} hide />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ stroke: "#94a3b8" }}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            labelFormatter={(_, p) => String((p?.[0]?.payload as MoodPoint | undefined)?.day ?? "")}
            formatter={(v, _n, p) => {
              const pt = p.payload as MoodPoint;
              return [`${Number(v).toFixed(2)} (${pt.confidence ?? "-"} confidence, ${pt.source_count} sources)`, "Mood"];
            }}
          />
          <Line type="monotone" dataKey="v" stroke="#2a78d6" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
