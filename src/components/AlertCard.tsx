"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeAlert, resolveAlert } from "@/actions/admin";
import type { AlertRow } from "@/lib/ui-types";

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};

const label = (s: string | null) => (s ? s.replace(/_/g, " ") : "-");

/**
 * One alert. Severity and rule come from the deterministic engine; the AI fields only explain.
 * All text (including LLM output and campaign names) is rendered as plain React text - never HTML.
 */
export function AlertCard({ alert, isAdmin }: { alert: AlertRow; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("confirmed_fraud");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Action failed.");
      else router.refresh();
    });

  const aiBadge =
    alert.ai_status === "done" ? (
      <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] text-indigo-800">AI</span>
    ) : alert.ai_status === "pending" ? (
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">explaining...</span>
    ) : (
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">Template</span>
    );

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${SEVERITY_STYLE[alert.severity] ?? ""}`}>{alert.severity}</span>
        <span className="font-mono text-xs">{alert.rule_code}</span>
        <span className="text-slate-500">on</span>
        <span className="font-mono text-xs">/r/{alert.link_slug}</span>
        {aiBadge}
        <span className="ml-auto text-xs text-slate-500">
          {new Date(alert.created_at).toLocaleString()} · {alert.status}
          {alert.resolution ? ` (${label(alert.resolution)})` : ""}
        </span>
      </div>
      <p className="mt-2 text-sm">{alert.ai_summary ?? "Explanation pending."}</p>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
        <span>Likely cause: {label(alert.ai_likely_cause)}</span>
        <span>Recommended: {label(alert.ai_recommended_action)}</span>
      </div>
      <button onClick={() => setOpen(!open)} className="mt-2 text-xs text-indigo-700 underline">
        {open ? "Hide details" : "Show evidence and explanation"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          <p className="text-slate-500">Campaign: {alert.campaign_name}</p>
          <pre className="overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify(alert.evidence, null, 2)}</pre>
          {alert.ai_explanation && <p className="text-sm text-slate-700">{alert.ai_explanation}</p>}
          <p className="text-slate-400">
            Window {new Date(alert.window_start).toLocaleString()} - {new Date(alert.window_end).toLocaleString()}
          </p>
        </div>
      )}
      {isAdmin && alert.status !== "resolved" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {alert.status === "open" && (
            <button disabled={pending} onClick={() => act(() => acknowledgeAlert(alert.id))} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
              Acknowledge
            </button>
          )}
          <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="rounded border border-slate-300 px-1 py-1 text-xs" aria-label="Resolution">
            <option value="confirmed_fraud">Confirmed fraud</option>
            <option value="false_alarm">False alarm</option>
            <option value="inconclusive">Inconclusive</option>
          </select>
          <button disabled={pending} onClick={() => act(() => resolveAlert(alert.id, resolution))} className="rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-50">
            Resolve
          </button>
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      )}
    </li>
  );
}
