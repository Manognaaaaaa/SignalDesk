import Link from "next/link";
import type { AssetRow, MoodPoint, StoryGroup } from "@/lib/ui-types";
import { MoodGauge } from "./MoodGauge";
import { Sparkline } from "./Sparkline";
import { StoryList } from "./StoryList";
import { label, panel } from "./ui";

const CONF_STYLE: Record<string, { cls: string; bars: number }> = {
  high: { cls: "text-fg", bars: 3 },
  medium: { cls: "text-muted", bars: 2 },
  low: { cls: "text-faint", bars: 1 },
};

/** Confidence as a 3-bar meter plus the word, so it reads at a glance and never by colour alone. */
function Confidence({ level, title }: { level: string; title: string }) {
  const c = CONF_STYLE[level] ?? CONF_STYLE.low!;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium ${c.cls}`} title={title}>
      <span className="inline-flex items-end gap-px" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`w-[3px] rounded-[1px] ${i <= c.bars ? "bg-current" : "bg-line-strong"}`} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      {level} confidence
    </span>
  );
}

/** One asset: today's mood gauge, confidence, 7-day sparkline and (optionally) its top stories. */
export function MoodCard({ asset, series, stories, aiOffline, empty }: { asset: AssetRow; series: MoodPoint[]; stories?: StoryGroup[]; aiOffline?: boolean; empty?: React.ReactNode }) {
  const today = series[series.length - 1];
  return (
    <article className={`group flex flex-col p-5 transition hover:border-line-strong ${panel}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/asset/${asset.slug}`} className="text-base font-semibold tracking-tight transition hover:text-accent">
            {asset.name}
          </Link>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-faint">{asset.description_simple}</p>
        </div>
        {today?.confidence && <Confidence level={today.confidence} title={`${today.source_count} sources, ${today.article_count} articles`} />}
      </header>
      <div className="mt-5">
        <MoodGauge score={today?.score ?? null} assetType={asset.asset_type} empty={empty} />
        {today && today.score !== null && (
          <p className="tabular mt-2 text-[11px] text-faint">
            {today.source_count} source{today.source_count === 1 ? "" : "s"} · {today.article_count} article{today.article_count === 1 ? "" : "s"} today
          </p>
        )}
        {aiOffline && today?.score == null && <p className="mt-2 text-[11px] text-warn">AI scoring offline: mentions are shown without stances.</p>}
      </div>
      <div className="mt-5">
        <p className={label}>7-day trend</p>
        <Sparkline points={series} label={asset.name} />
      </div>
      {stories && (
        <div className="mt-4 border-t border-line/70 pt-3">
          <p className={label}>Top stories</p>
          <StoryList stories={stories.slice(0, 3)} assetSlug={asset.slug} compact />
        </div>
      )}
    </article>
  );
}
