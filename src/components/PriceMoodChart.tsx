"use client";
import { useCallback, useMemo, useState } from "react";
import { Bar, BarChart, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AssetType } from "@/config/assets-seed";
import { priceChange, type ChartRow } from "@/lib/chart";
import { timeAgo } from "@/lib/format";
import type { TimelineSignal } from "@/lib/ui-types";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { StanceBadge } from "./StanceBadge";
import { label as labelCls, panel } from "./ui";

const RANGES = [30, 90] as const;
const SYNC = "price-mood";

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function fmtPrice(v: number): string {
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 2 : abs >= 10 ? 3 : 5;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Mood vs price. Top: daily close (Deriv) with a dot on each day that had scored news, coloured
 * by that day's net direction. Bottom: the daily mood score (-1..+1). Clicking a dot (or a
 * "news day" button, for keyboard users) lists that day's signals; each opens its receipt.
 * Without a price feed only the mood panel is shown.
 */
export function PriceMoodChart({
  rows,
  signals,
  assetType,
  assetSlug,
  priceLabel,
  otc,
}: {
  rows: ChartRow[];
  signals: TimelineSignal[];
  assetType: AssetType;
  assetSlug: string;
  priceLabel: string | null;
  otc?: boolean;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(90);
  const view = useMemo(() => rows.slice(-range), [rows, range]);
  const newsDays = useMemo(() => view.filter((r) => r.signals > 0).map((r) => r.day), [view]);
  const [selected, setSelected] = useState<string | null>(newsDays.at(-1) ?? null);
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const cb = assetType === "central_bank";
  const upColor = cb ? "var(--color-hawk)" : "var(--color-up)";
  const downColor = cb ? "var(--color-dove)" : "var(--color-down)";
  const dirColor = (net: number) => (net > 0 ? upColor : net < 0 ? downColor : "var(--color-muted)");
  const hasPrice = priceLabel !== null && view.some((r) => r.close !== null);
  const change = hasPrice ? priceChange(view) : null;
  const daySignals = selected ? signals.filter((s) => s.day === selected) : [];

  const pick = (day: string | undefined) => {
    if (day && view.find((r) => r.day === day)?.signals) setSelected(day);
  };

  const tooltip = {
    cursor: { stroke: "var(--color-line-strong)" },
    contentStyle: { fontSize: 12, borderRadius: 8, background: "var(--color-raised)", border: "1px solid var(--color-line-strong)", color: "var(--color-fg)" },
    labelStyle: { color: "var(--color-muted)" },
    labelFormatter: (d: unknown) => fmtDay(String(d)),
  };

  return (
    <section className={`p-5 ${panel}`} aria-labelledby="pm-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pm-title" className="text-base font-semibold tracking-tight">
            {hasPrice ? "News mood vs price" : "News mood over time"}
          </h2>
          <p className="mt-1 text-xs text-faint">
            {hasPrice ? (
              <>
                {priceLabel} daily close from Deriv{otc ? " (OTC price that tracks the index)" : ""}
                {change !== null && (
                  <span className={`tabular ml-2 font-mono ${change >= 0 ? "text-up" : "text-down"}`}>
                    {change >= 0 ? "+" : ""}
                    {change.toFixed(2)}% over {range} d
                  </span>
                )}
              </>
            ) : (
              "No price feed for this asset, so only the daily news mood is shown."
            )}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-bg p-0.5 text-xs" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={`rounded-md px-2.5 py-1 transition ${range === r ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      {hasPrice && (
        <div className="mt-4 h-56" role="img" aria-label={`${priceLabel} daily close over ${range} days, with dots on days that had news`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={view} syncId={SYNC} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} onClick={(s) => pick(s?.activeLabel as string | undefined)}>
              <XAxis dataKey="day" hide />
              <YAxis orientation="right" domain={["auto", "auto"]} tick={{ fill: "var(--color-faint)", fontSize: 11 }} tickFormatter={fmtPrice} width={64} axisLine={false} tickLine={false} />
              <Tooltip {...tooltip} formatter={(v) => [fmtPrice(Number(v)), "Close"]} />
              <Line
                type="monotone"
                dataKey="close"
                connectNulls
                stroke="var(--color-fg)"
                strokeOpacity={0.8}
                strokeWidth={1.5}
                isAnimationActive={false}
                activeDot={{ r: 3, fill: "var(--color-fg)" }}
                dot={(p: { cx?: number; cy?: number; payload?: ChartRow; index?: number }) => {
                  const r = p.payload;
                  if (!r || !r.signals || p.cx == null || p.cy == null) return <g key={`d${p.index}`} />;
                  const on = r.day === selected;
                  return (
                    <circle
                      key={`d${p.index}`}
                      cx={p.cx}
                      cy={p.cy}
                      r={3 + Math.min(r.signals, 5) * 0.8}
                      fill={dirColor(r.net)}
                      stroke={on ? "var(--color-fg)" : "var(--color-bg)"}
                      strokeWidth={on ? 2 : 1.5}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelected(r.day)}
                    />
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className={hasPrice ? "mt-1 h-24" : "mt-4 h-40"} role="img" aria-label={`Daily news mood over ${range} days, from -1 to +1`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={view} syncId={SYNC} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} onClick={(s) => pick(s?.activeLabel as string | undefined)}>
            <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: "var(--color-faint)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis orientation="right" domain={[-1, 1]} ticks={[-1, 0, 1]} tick={{ fill: "var(--color-faint)", fontSize: 11 }} width={64} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke="var(--color-line-strong)" />
            <Tooltip {...tooltip} formatter={(v, _n, p) => [`${Number(v).toFixed(2)}${(p.payload as ChartRow).confidence ? ` (${(p.payload as ChartRow).confidence} confidence)` : ""}`, "Mood"]} />
            <Bar dataKey="mood" isAnimationActive={false} radius={[2, 2, 2, 2]}>
              {view.map((r) => (
                <Cell key={r.day} fill={r.mood === null ? "transparent" : r.mood >= 0 ? upColor : downColor} fillOpacity={r.day === selected ? 1 : 0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Mood is what the news said; price is what the market did. They are shown together to compare, not to claim that one caused the other.
      </p>

      <div className="mt-5 border-t border-line/70 pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${labelCls} mr-1`}>News days</span>
          {newsDays.length === 0 && <span className="text-xs text-faint">No scored news in this range yet.</span>}
          {[...newsDays].reverse().map((d) => {
            const r = view.find((x) => x.day === d)!;
            return (
              <button
                key={d}
                onClick={() => setSelected(d)}
                aria-pressed={selected === d}
                className={`tabular inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${selected === d ? "border-line-strong bg-raised text-fg" : "border-line text-muted hover:text-fg"}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: dirColor(r.net) }} aria-hidden="true" />
                {fmtDay(d)} · {r.signals}
              </button>
            );
          })}
        </div>
        {selected && daySignals.length > 0 && (
          <ul className="mt-3 divide-y divide-line/70">
            {daySignals.map((s) => (
              <li key={s.article_id}>
                <button onClick={() => setOpen(s.article_id)} className="group -mx-2 flex w-[calc(100%+1rem)] flex-wrap items-center gap-2 rounded-md px-2 py-2 text-left transition hover:bg-raised">
                  <StanceBadge stance={s.stance} strength={s.strength} />
                  <span className="min-w-0 flex-1 text-sm leading-snug">{s.title}</span>
                  <span className="text-xs text-faint">
                    {s.source} · {timeAgo(s.at)}
                  </span>
                  <span className="text-xs text-accent opacity-0 transition group-hover:opacity-100" aria-hidden="true">
                    receipt →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <EvidenceDrawer articleId={open} assetSlugs={[assetSlug]} onClose={close} />
    </section>
  );
}
