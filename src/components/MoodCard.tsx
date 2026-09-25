import Link from "next/link";
import type { AssetRow, MoodPoint, StoryGroup } from "@/lib/ui-types";
import { MoodGauge } from "./MoodGauge";
import { Sparkline } from "./Sparkline";
import { StoryList } from "./StoryList";

const CONF_STYLE: Record<string, string> = {
  high: "bg-slate-900 text-white dark:bg-white dark:text-slate-900",
  medium: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  low: "border border-dashed border-slate-400 text-slate-600 dark:text-slate-300",
};

/** One asset: today's mood gauge, confidence, 7-day sparkline and (optionally) its top stories. */
export function MoodCard({ asset, series, stories, aiOffline }: { asset: AssetRow; series: MoodPoint[]; stories?: StoryGroup[]; aiOffline?: boolean }) {
  const today = series[series.length - 1];
  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-2">
        <div>
          <Link href={`/asset/${asset.slug}`} className="text-base font-semibold hover:underline">
            {asset.name}
          </Link>
          <p className="text-xs text-slate-500 dark:text-slate-400">{asset.description_simple}</p>
        </div>
        {today?.confidence && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${CONF_STYLE[today.confidence]}`} title={`${today.source_count} sources, ${today.article_count} articles`}>
            {today.confidence} confidence
          </span>
        )}
      </header>
      <div className="mt-3">
        <MoodGauge score={today?.score ?? null} assetType={asset.asset_type} />
        {today && today.score !== null && (
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {today.source_count} source{today.source_count === 1 ? "" : "s"} · {today.article_count} article{today.article_count === 1 ? "" : "s"} today
          </p>
        )}
        {aiOffline && today?.score == null && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">AI scoring offline: mentions are shown without stances.</p>}
      </div>
      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">7-day trend</p>
        <Sparkline points={series} label={asset.name} />
      </div>
      {stories && (
        <div className="mt-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Top stories</p>
          <StoryList stories={stories.slice(0, 3)} assetSlug={asset.slug} compact />
        </div>
      )}
    </article>
  );
}
