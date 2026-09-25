"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Evaluation charts (recharts). Palette: reference categorical slots 1-2 (blue, orange), thin
 * marks, recessive grid, one y-axis per chart, tooltips on hover. Every chart has a companion
 * table on the page, so no number depends on reading colour.
 */

const BLUE = "#2a78d6";
const ORANGE = "#eb6834";
const GRID = "#e7e5e4";
const AXIS = { fontSize: 11, fill: "#52514e" };
const pctTick = (v: number) => `${Math.round(v * 100)}%`;
const pctTip = (v: unknown) => `${(Number(v) * 100).toFixed(1)}%`;

export type DetectionBar = { kind: string; rate: number; low: number; high: number };

/** Detection rate per attack kind with 95% Wilson CI error bars. */
export function DetectionChart({ data }: { data: DetectionBar[] }) {
  const rows = data.map((d) => ({ ...d, err: [d.rate - d.low, d.high - d.rate] as [number, number] }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="kind" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 1]} tickFormatter={pctTick} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v) => pctTip(v)}
            labelFormatter={(l, p) => {
              const d = p?.[0]?.payload as DetectionBar | undefined;
              return d ? `${l} (95% CI ${pctTip(d.low)}-${pctTip(d.high)})` : String(l);
            }}
          />
          <Bar dataKey="rate" name="Detection rate" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
            <ErrorBar dataKey="err" width={8} stroke="#0b0b0b" strokeWidth={1.5} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Detection rate vs attack intensity, with the breaking point marked. */
export function SensitivityChart({ levels, breakingPoint, parameter }: { levels: { level: number; rate: number }[]; breakingPoint: number | null; parameter: string }) {
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={levels} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="level" tick={AXIS} axisLine={false} tickLine={false} label={{ value: parameter, position: "insideBottom", offset: -4, fontSize: 11, fill: "#52514e" }} height={36} />
          <YAxis domain={[0, 1]} tickFormatter={pctTick} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => pctTip(v)} labelFormatter={(l) => `${parameter}: ${l}`} />
          <ReferenceLine y={0.9} stroke="#8a8984" strokeDasharray="4 4" />
          {breakingPoint !== null && (
            <ReferenceLine x={breakingPoint} stroke={ORANGE} strokeWidth={2} label={{ value: `breaking point ${breakingPoint}`, position: "top", fontSize: 11, fill: "#0b0b0b" }} />
          )}
          <Line type="monotone" dataKey="rate" name="Detection rate" stroke={BLUE} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** False alerts per day, one bar per rule. */
export function FalseAlarmChart({ data }: { data: { rule: string; per_day: number }[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="rule" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => `${v} per day`} />
          <Bar dataKey="per_day" name="False alerts / day" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Replay: attribution (conversion) rate of flagged vs unflagged clicks. */
export function AttributionChart({ flagged, unflagged }: { flagged: number; unflagged: number }) {
  const data = [
    { group: "Flagged clicks", rate: flagged, fill: ORANGE },
    { group: "Unflagged clicks", rate: unflagged, fill: BLUE },
  ];
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="group" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v: number) => `${(v * 100).toFixed(2)}%`} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(3)}%`} />
          <Bar dataKey="rate" name="Attribution rate" radius={[4, 4, 0, 0]} maxBarSize={72} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.group} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
