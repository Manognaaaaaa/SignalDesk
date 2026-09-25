import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSystemInfo } from "@/lib/dashboard-data";

export const metadata = { title: "System - LinkPulse" };

/** Admin-only operational view: recent job runs and 30-day LLM usage/cost. */
export default async function SystemPage() {
  if (!(await requireAdmin())) redirect("/dashboard");
  const { jobs, usage } = await getSystemInfo();
  const u = usage ?? {};
  const tiles = [
    { label: "LLM calls (30 d)", value: Number(u.calls ?? 0).toLocaleString("en-US") },
    { label: "Failed / retried", value: Number(u.failed_calls ?? 0).toLocaleString("en-US") },
    { label: "Tokens in / out", value: `${Number(u.input_tokens ?? 0).toLocaleString("en-US")} / ${Number(u.output_tokens ?? 0).toLocaleString("en-US")}` },
    { label: "Est. cost (USD)", value: `$${Number(u.est_cost_usd ?? 0).toFixed(4)}` },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">System</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">{t.label}</div>
            <div className="mt-1 text-xl font-semibold">{t.value}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="p-2">Job</th>
              <th className="p-2">Started</th>
              <th className="p-2">Status</th>
              <th className="p-2">Stats</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-slate-500">
                  No job runs yet.
                </td>
              </tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-slate-100 align-top">
                <td className="p-2 font-mono text-xs">{j.job}</td>
                <td className="p-2 text-xs">{new Date(j.started_at).toLocaleString()}</td>
                <td className={`p-2 text-xs ${j.status === "ok" ? "text-emerald-700" : "text-red-700"}`}>{j.status}</td>
                <td className="p-2">
                  <code className="block max-w-xl overflow-x-auto whitespace-nowrap text-[11px] text-slate-600">{JSON.stringify(j.stats)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
