import type { AssetType } from "@/config/assets-seed";
import { moodWord } from "@/lib/mood/labels";

/** Horizontal -1..+1 gauge with a marker, the plain-language word and the numeric score. */
export function MoodGauge({ score, assetType }: { score: number | null; assetType: AssetType }) {
  const up = assetType === "central_bank" ? "hawkish" : "bullish";
  const down = assetType === "central_bank" ? "dovish" : "bearish";
  if (score === null) return <p className="text-sm text-slate-500 dark:text-slate-400">No scored news today</p>;
  const pct = ((score + 1) / 2) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-base font-semibold capitalize">{moodWord(score, assetType)}</span>
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{score > 0 ? "+" : ""}{score.toFixed(2)}</span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-rose-200 via-slate-200 to-emerald-200 dark:from-rose-900 dark:via-slate-700 dark:to-emerald-900" role="meter" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={score} aria-label="Mood score">
        <span className="absolute top-1/2 left-1/2 h-3 w-px -translate-y-1/2 bg-slate-400" aria-hidden="true" />
        <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow dark:border-slate-900 dark:bg-white" style={{ left: `${pct}%` }} aria-hidden="true" />
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-slate-400">
        <span>{down}</span>
        <span>{up}</span>
      </div>
    </div>
  );
}
