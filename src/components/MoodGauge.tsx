import type { AssetType } from "@/config/assets-seed";
import { moodWord } from "@/lib/mood/labels";

/** Horizontal -1..+1 gauge with a marker, the plain-language word and the numeric score. */
export function MoodGauge({ score, assetType, empty }: { score: number | null; assetType: AssetType; empty?: React.ReactNode }) {
  const cb = assetType === "central_bank";
  const up = cb ? "hawkish" : "bullish";
  const down = cb ? "dovish" : "bearish";
  if (score === null) return <div className="text-sm text-faint">{empty ?? "No scored news today"}</div>;
  const pct = ((score + 1) / 2) * 100;
  const tone = score > 0.15 ? (cb ? "text-hawk" : "text-up") : score < -0.15 ? (cb ? "text-dove" : "text-down") : "text-fg";
  const track = cb ? "from-dove/50 via-line-strong to-hawk/50" : "from-down/50 via-line-strong to-up/50";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-lg font-semibold tracking-tight first-letter:uppercase ${tone}`}>{moodWord(score, assetType)}</span>
        <span className="tabular font-mono text-sm text-muted">
          {score > 0 ? "+" : ""}
          {score.toFixed(2)}
        </span>
      </div>
      <div className={`relative mt-2.5 h-1.5 rounded-full bg-gradient-to-r ${track}`} role="meter" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={score} aria-label="Mood score">
        <span className="absolute top-1/2 left-1/2 h-3 w-px -translate-y-1/2 bg-faint" aria-hidden="true" />
        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-fg shadow-[0_0_0_3px_rgb(0_0_0/0.25)]" style={{ left: `${pct}%` }} aria-hidden="true" />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        <span>{down}</span>
        <span>{up}</span>
      </div>
    </div>
  );
}
