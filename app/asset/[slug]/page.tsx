import { notFound } from "next/navigation";
import { Disclaimer } from "@/components/Disclaimer";
import { EvidenceSentences } from "@/components/EvidenceSentences";
import { MoodCard } from "@/components/MoodCard";
import { StanceBadge } from "@/components/StanceBadge";
import { StoryList } from "@/components/StoryList";
import { panel, textLink } from "@/components/ui";
import { getAssetBySlug, getMoodSeries, getPriceSeries, getSignalsForAsset, getSignalTimeline, getStoriesForAsset } from "@/lib/data";
import { PriceMoodChart } from "@/components/PriceMoodChart";
import { PRICE_SYMBOLS } from "@/config/price-symbols";
import { buildChartRows } from "@/lib/chart";
import { LastSignalNote } from "@/components/LastSignalNote";
import { safeHref, timeAgo } from "@/lib/format";
import { GLOSSARY } from "@/lib/mood/labels";

export const dynamic = "force-dynamic";

/** Public asset page: 7-day mood, grouped stories, every signal with its evidence, plain explainer. */
export default async function AssetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,30}$/.test(slug)) notFound();
  const asset = await getAssetBySlug(slug);
  if (!asset) notFound();
  const CHART_DAYS = 90;
  const priceSym = PRICE_SYMBOLS[asset.slug] ?? null;
  const [series, stories, signals, longMood, prices, timeline] = await Promise.all([
    getMoodSeries([asset.id]),
    getStoriesForAsset(asset.id, 72, 30),
    getSignalsForAsset(asset.id, 7),
    getMoodSeries([asset.id], CHART_DAYS),
    priceSym ? getPriceSeries(asset.id, CHART_DAYS) : Promise.resolve([]),
    getSignalTimeline(asset.id, CHART_DAYS),
  ]);
  const chartRows = buildChartRows(prices, longMood.get(asset.id) ?? [], timeline, CHART_DAYS);
  const scored = signals.find((s) => s.status !== "failed" && s.stance !== "unclear");
  const lastSignal = scored ? { stance: scored.stance, at: scored.at } : null;
  const terms = asset.asset_type === "central_bank" ? ["hawkish", "dovish"] : ["bullish", "bearish"];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">{asset.name}</h1>
        <p className="mt-2 max-w-2xl text-muted">{asset.description_simple}</p>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-faint">
          {terms.map((t) => `${t[0]!.toUpperCase()}${t.slice(1)} = ${GLOSSARY[t]}`).join(" · ")}. Unclear = {GLOSSARY.unclear}.
        </p>
      </div>

      <PriceMoodChart rows={chartRows} signals={timeline} assetType={asset.asset_type} assetSlug={asset.slug} priceLabel={priceSym?.label ?? null} otc={priceSym?.otc} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-1">
          <MoodCard asset={asset} series={series.get(asset.id) ?? []} empty={<LastSignalNote last={lastSignal} />} />
        </div>
        <section className={`p-5 md:col-span-2 ${panel}`}>
          <h2 className="text-base font-semibold tracking-tight">Stories <span className="font-normal text-faint">· last 3 days</span></h2>
          <StoryList stories={stories} assetSlug={asset.slug} />
        </section>
      </div>

      <section>
        <h2 className="text-base font-semibold tracking-tight">Every signal, with its evidence <span className="font-normal text-faint">· last 7 days</span></h2>
        {signals.length === 0 && <p className="mt-3 rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">No scored articles for this asset in the last 7 days. New headlines are checked every two hours.</p>}
        <ul className="mt-3 space-y-3">
          {signals.map((s) => {
            const href = safeHref(s.url);
            return (
              <li key={s.article_id} className={`p-5 ${panel}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <StanceBadge stance={s.stance} strength={s.strength} failed={s.status === "failed"} />
                  <span className="text-xs text-faint">
                    {s.source} · {timeAgo(s.at)}
                  </span>
                </div>
                <h3 className="mt-2.5 font-medium leading-snug">{s.title}</h3>
                {s.why && <p className="mt-1.5 text-sm text-muted">{s.why}</p>}
                <div className="mt-3">
                  <EvidenceSentences sentences={s.sentences} evidenceIds={s.evidence_ids} />
                </div>
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={`mt-3 inline-block text-sm ${textLink}`}>
                    Read the original ↗
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <Disclaimer />
    </div>
  );
}
