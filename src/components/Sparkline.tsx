"use client";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { MoodPoint } from "@/lib/ui-types";

/**
 * 7-day mood sparkline (-1..+1, zero line dashed). One series, so no legend: the card title names
 * it. Days without scored news are gaps, not zeros. Hover shows the exact day, score and confidence.
 * Colours are the design tokens (CSS variables), so the chart follows the theme.
 */
export function Sparkline({ points, height = 44, label }: { points: MoodPoint[]; height?: number; label: string }) {
  const data = points.map((p) => ({ ...p, v: p.score }));
  const has = points.some((p) => p.score !== null);
  if (!has)
    return (
      <div className="flex items-center text-xs text-faint" style={{ height }}>
        No mood history yet
      </div>
    );
  return (
    <div style={{ height }} role="img" aria-label={`${label}: 7-day mood trend`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 4, bottom: 6, left: 4 }}>
          <YAxis domain={[-1, 1]} hide />
          <ReferenceLine y={0} stroke="var(--color-line-strong)" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ stroke: "var(--color-line-strong)" }}
            contentStyle={{ fontSize: 12, borderRadius: 8, background: "var(--color-raised)", border: "1px solid var(--color-line-strong)", color: "var(--color-fg)" }}
            labelStyle={{ color: "var(--color-muted)" }}
            itemStyle={{ color: "var(--color-fg)" }}
            labelFormatter={(_, p) => String((p?.[0]?.payload as MoodPoint | undefined)?.day ?? "")}
            formatter={(v, _n, p) => {
              const pt = p.payload as MoodPoint;
              return [`${Number(v).toFixed(2)} (${pt.confidence ?? "-"} confidence, ${pt.source_count} sources)`, "Mood"];
            }}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke="var(--color-fg)"
            strokeOpacity={0.85}
            strokeWidth={1.75}
            dot={{ r: 2, fill: "var(--color-bg)", stroke: "var(--color-fg)", strokeWidth: 1.5 }}
            activeDot={{ r: 4, fill: "var(--color-accent)", stroke: "var(--color-bg)" }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
