"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runDetectionNow } from "@/actions/admin";

const SCENARIOS = [
  { value: "bot_burst", label: "Bot burst (one IP hammering a link)" },
  { value: "click_farm", label: "Click farm (off-target, no conversions)" },
  { value: "spike", label: "Click spike (10x normal volume)" },
  { value: "slow_drip", label: "Slow drip (held-out: usually NOT caught)" },
  { value: "distributed_bots", label: "Distributed bots (held-out: usually NOT caught)" },
];

/** Admin-only demo controls: inject a simulated attack, or run the detection job immediately. */
export function SimulatePanel() {
  const [scenario, setScenario] = useState("bot_burst");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const simulate = () =>
    start(async () => {
      setMessage("Simulating attack and running detection...");
      try {
        const res = await fetch("/api/admin/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          simulation?: { link_slug: string; events_written: number };
          detection?: { inserted: number };
        };
        if (!res.ok) setMessage(body.error ?? "Simulation failed.");
        else
          setMessage(
            `Wrote ${body.simulation?.events_written ?? 0} clicks on /r/${body.simulation?.link_slug}; detection created ${body.detection?.inserted ?? 0} new alert(s).`,
          );
        router.refresh();
      } catch {
        setMessage("Simulation failed.");
      }
    });

  const detect = () =>
    start(async () => {
      setMessage("Running detection...");
      const r = await runDetectionNow();
      setMessage(r.ok ? `Detection finished: ${"inserted" in r ? (r.inserted ?? 0) : 0} new alert(s).` : r.error);
      router.refresh();
    });

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <h2 className="text-sm font-semibold">Demo controls (admin)</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={scenario} onChange={(e) => setScenario(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm" aria-label="Attack scenario">
          {SCENARIOS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button disabled={pending} onClick={simulate} className="rounded bg-indigo-700 px-3 py-1 text-sm text-white disabled:opacity-50">
          Simulate attack
        </button>
        <button disabled={pending} onClick={detect} className="rounded border border-indigo-700 px-3 py-1 text-sm text-indigo-800 disabled:opacity-50">
          Run detection now
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-slate-700">{message}</p>}
      <p className="mt-2 text-[11px] text-slate-500">Max 3 simulations per 10 minutes. Simulated rows are labelled dataset=&apos;simulated&apos;.</p>
    </div>
  );
}
