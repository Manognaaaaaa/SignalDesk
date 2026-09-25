import { notFound } from "next/navigation";
import { Disclaimer } from "@/components/Disclaimer";
import { EvidenceSentences } from "@/components/EvidenceSentences";
import { MoodCard } from "@/components/MoodCard";
import { StanceBadge } from "@/components/StanceBadge";
import { StoryList } from "@/components/StoryList";
import { getAssetBySlug, getMoodSeries, getSignalsForAsset, getStoriesForAsset } from "@/lib/data";
import { safeHref, timeAgo } from "@/lib/format";
import { GLOSSARY } from "@/lib/mood/labels";

export const dynamic = "force-dynamic";

/** Public asset page: 7-day mood, grouped stories, every signal with its evidence, plain explainer. */
export default async function AssetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,30}$/.test(slug)) notFound();
  const asset = await getAssetBySlug(slug);
  if (!asset) notFound();
  const [series, stories, signals] = await Promise.all([getMoodSeries([asset.id]), getStoriesForAsset(asset.id, 72, 30), getSignalsForAsset(asset.id, 7)]);
  const terms = asset.asset_type === "central_bank" ? ["hawkish", "dovish"] : ["bullish", "bearish"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{asset.description_simple}</p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {terms.map((t) => `${t[0]!.toUpperCase()}${t.slice(1)} = ${GLOSSARY[t]}`).join(" · ")}. Unclear = {GLOSSARY.unclear}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-1">
          <MoodCard asset={asset} series={series.get(asset.id) ?? []} />
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 md:col-span-2 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold">Stories (last 3 days)</h2>
          <StoryList stories={stories} assetSlug={asset.slug} />
        </section>
      </div>

      <section>
        <h2 className="text-base font-semibold">Every signal, with its evidence (last 7 days)</h2>
        {signals.length === 0 && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No scored articles yet for this asset.</p>}
        <ul className="mt-3 space-y-3">
          {signals.map((s) => {
            const href = safeHref(s.url);
            return (
              <li key={s.article_id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center gap-2">
                  <StanceBadge stance={s.stance} strength={s.strength} failed={s.status === "failed"} />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {s.source} · {timeAgo(s.at)}
                  </span>
                </div>
                <h3 className="mt-2 font-medium">{s.title}</h3>
                {s.why && <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{s.why}</p>}
                <div className="mt-2">
                  <EvidenceSentences sentences={s.sentences} evidenceIds={s.evidence_ids} />
                </div>
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-block text-sm text-slate-600 underline dark:text-slate-300">
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
