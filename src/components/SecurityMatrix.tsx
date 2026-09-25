import type { SecurityCheck } from "@/eval/types";

/** Pass/fail matrix from scripts/security-check.ts. Status is shown as text + symbol, never colour alone. */
export function SecurityMatrix({ checks }: { checks: SecurityCheck[] }) {
  if (checks.length === 0) return <p className="text-sm text-slate-500">No security check results yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="p-2">Category</th>
            <th className="p-2">Check</th>
            <th className="p-2">Result</th>
            <th className="p-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={`${c.category}-${c.name}`} className="border-t border-slate-100">
              <td className="p-2 text-xs text-slate-500">{c.category}</td>
              <td className="p-2">{c.name}</td>
              <td className={`p-2 font-medium ${c.pass ? "text-emerald-800" : "text-red-800"}`}>{c.pass ? "✓ pass" : "✗ FAIL"}</td>
              <td className="p-2 text-xs text-slate-600">{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
