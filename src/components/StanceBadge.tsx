/**
 * Stance label with a consistent colour AND a text label + symbol (never colour alone).
 * Up-stances (bullish/hawkish) are green-ish, down-stances (bearish/dovish) red-ish, neutral grey,
 * unclear a dashed outline.
 */
const STYLE: Record<string, { cls: string; sym: string }> = {
  bullish: { cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200", sym: "▲" },
  hawkish: { cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200", sym: "▲" },
  bearish: { cls: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200", sym: "▼" },
  dovish: { cls: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200", sym: "▼" },
  neutral: { cls: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200", sym: "●" },
  unclear: { cls: "border-dashed border-slate-400 bg-transparent text-slate-600 dark:border-slate-500 dark:text-slate-300", sym: "?" },
};

export function StanceBadge({ stance, strength, failed }: { stance: string | null; strength?: number | null; failed?: boolean }) {
  const key = failed || !stance ? "unclear" : stance;
  const s = STYLE[key] ?? STYLE.unclear!;
  const label = failed ? "not scored" : (stance ?? "not scored");
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span aria-hidden="true">{s.sym}</span>
      {label}
      {strength != null && strength > 0 && !failed && stance !== "unclear" && <span className="opacity-70">· {strength}/3</span>}
    </span>
  );
}
