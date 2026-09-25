"use client";
import { useState } from "react";
import type { AlertRow } from "@/lib/ui-types";
import { AlertCard } from "./AlertCard";

/** Alert list with a status filter. Rows arrive from the server; Realtime triggers a re-fetch. */
export function AlertsFeed({ alerts, isAdmin, title = "Alerts" }: { alerts: AlertRow[]; isAdmin: boolean; title?: string }) {
  const [filter, setFilter] = useState<"active" | "all">("active");
  const shown = filter === "all" ? alerts : alerts.filter((a) => a.status !== "resolved");
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "active" | "all")} className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs" aria-label="Alert filter">
          <option value="active">Open + acknowledged</option>
          <option value="all">All</option>
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No alerts. Detection runs every 5 minutes.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((a) => (
            <AlertCard key={a.id} alert={a} isAdmin={isAdmin} />
          ))}
        </ul>
      )}
    </section>
  );
}
