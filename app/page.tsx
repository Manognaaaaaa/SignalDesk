import Link from "next/link";
import { Disclaimer } from "@/components/Disclaimer";
import { EvidenceSentences } from "@/components/EvidenceSentences";
import { LastSignalNote } from "@/components/LastSignalNote";
import { MoodGauge } from "@/components/MoodGauge";
import { Sparkline } from "@/components/Sparkline";
import { StanceBadge } from "@/components/StanceBadge";
import { btnPrimary, label, panel, textLink } from "@/components/ui";
import { getActiveAssets, getCatalogue, getLatestReceipt, getMoodSeries, getSiteStats } from "@/lib/data";
import { safeHref, timeAgo } from "@/lib/format";
import type { Receipt } from "@/lib/ui-types";

export const dynamic = "force-dynamic";

const BOARD_SIZE = 6;

/** A real signal from the last 48 h, shown the way the Evidence drawer shows it. */
function ReceiptCard({ r }: { r: Receipt }) {
  const href = safeHref(r.url);
  return (
    <figure className={`relative p-5 sm:p-6 ${panel} shadow-[0_30px_80px_-40px_rgb(63_196_141/0.25)]`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`${label} flex items-center gap-2`}>
          <span className="h-1.5 w-1.5 rounded-full bg-mark" aria-hidden="true" />
          A real receipt · {timeAgo(r.at)}
        </p>
        <span className="text-xs text-faint">{r.source}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={`/asset/${r.asset.slug}`} className="text-sm font-semibold transition hover:text-accent">
          {r.asset.name}
        </Link>
        <StanceBadge stance={r.stance} strength={r.strength} />
      </div>
      {/* S1 is always the headline; show it separately only if it is not among the stored sentences. */}
      {!r.sentences.some((s) => s.id === "S1") && <blockquote className="mt-3 text-[15px] font-medium leading-snug">{r.title}</blockquote>}
      <div className="mt-4">
        <EvidenceSentences sentences={r.sentences} evidenceIds={r.evidence_ids} />
      </div>
      {r.why && (
        <figcaption className="mt-4 border-t border-line/70 pt-3 text-sm text-muted">
          <span className="text-faint">Why: </span>
          {r.why}
        </figcaption>
      )}
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={`mt-3 inline-block text-xs ${textLink}`}>
          Read the original ↗
        </a>
      )}
    </figure>
  );
}

/** Public landing page: pitch + a live receipt, live counts, and a board of the most-covered assets. */
export default async function Home() {
  const catalogue = await getCatalogue();
  const [receipt, active, stats] = await Promise.all([getLatestReceipt(), getActiveAssets(catalogue), getSiteStats()]);
  const board = active.slice(0, BOARD_SIZE);
  const series = await getMoodSeries(board.map((b) => b.asset.id));

  const statItems = [
    [stats.sources, "sources tracked"],
    [stats.articles24h, "articles in 24 h"],
    [stats.signals24h, "scored in 24 h"],
    [stats.assets, "assets covered"],
  ] as const;

  return (
    <div className="space-y-20 pb-8">
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.25fr_1fr] lg:gap-14 lg:pt-10">
        <div>
          <p className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-muted">
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            {stats.lastUpdated ? `Live · feeds checked ${timeAgo(stats.lastUpdated)}` : "Live · feeds checked every 2 hours"}
          </p>
          <h1 className="mt-5 text-4xl leading-[1.05] font-semibold tracking-[-0.03em] sm:text-5xl xl:text-[3.5rem]">
            What moved your assets today, <span className="text-muted">and why.</span>
          </h1>
          <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-muted">
            SignalDesk reads central-bank and market headlines every two hours and scores the mood for each asset you follow. Every claim links back to the exact sentences it
            came from, so you can check it in seconds.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Link href="/login" className={`${btnPrimary} px-5 py-2.5`}>
              Build your watchlist
            </Link>
            <Link href="/how-it-works" className={`text-sm ${textLink}`}>
              How the scoring works →
            </Link>
          </div>
          <dl className="mt-10 grid max-w-lg grid-cols-2 gap-x-8 gap-y-4 border-t border-line/70 pt-6 sm:grid-cols-4">
            {statItems.map(([n, text]) => (
              <div key={text}>
                <dt className="sr-only">{text}</dt>
                <dd className="tabular font-mono text-2xl font-medium tracking-tight">{n}</dd>
                <dd className="mt-0.5 text-xs text-faint">{text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative lg:-mr-2">
          <div className="pointer-events-none absolute -inset-8 -z-10 hidden rounded-[2rem] lg:block bg-[radial-gradient(60%_50%_at_60%_40%,rgb(63_196_141/0.10),transparent_70%)]" aria-hidden="true" />
          {receipt ? (
            <ReceiptCard r={receipt} />
          ) : (
            <div className={`p-6 text-sm text-muted ${panel}`}>No strong signals in the last 48 hours. The next feed check runs within two hours.</div>
          )}
        </div>
      </section>

      <section aria-labelledby="board">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="board" className="text-xl font-semibold tracking-tight">
              Most covered right now
            </h2>
            <p className="mt-1 text-sm text-faint">Assets ranked by scored signals in the last 48 hours. Open one to see every signal and its evidence.</p>
          </div>
        </div>
        {board.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-line-strong p-6 text-sm text-muted">The catalogue is not set up yet.</p>
        ) : (
          <ul className="mt-5 overflow-hidden rounded-xl border border-line/70 bg-line/70">
            {board.map(({ asset, signals, last }) => (
              <li key={asset.id} className="border-b border-line/70 bg-surface last:border-b-0">
                <Link href={`/asset/${asset.slug}`} className="group grid items-center gap-x-6 gap-y-3 p-4 transition hover:bg-raised sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:px-5">
                  <div className="min-w-0">
                    <p className="font-semibold tracking-tight transition group-hover:text-accent">{asset.name}</p>
                    <p className="mt-0.5 truncate text-xs text-faint">{asset.description_simple}</p>
                  </div>
                  <MoodGauge score={series.get(asset.id)?.at(-1)?.score ?? null} assetType={asset.asset_type} empty={<LastSignalNote last={last} />} />
                  <div className="hidden sm:block">
                    <Sparkline points={series.get(asset.id) ?? []} label={asset.name} height={36} />
                  </div>
                  <p className="tabular text-right text-xs text-faint">
                    <span className="font-mono text-sm text-fg">{signals}</span> signals · 48 h
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="method" className="grid gap-8 border-t border-line/70 pt-12 lg:grid-cols-[1fr_2fr]">
        <div>
          <h2 id="method" className="text-xl font-semibold tracking-tight">
            Deterministic where possible
          </h2>
          <p className="mt-2 text-sm text-muted">AI is used for exactly two things, and neither can invent a quote.</p>
        </div>
        <ol className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {[
            ["Match", "A curated list of names and tickers decides which assets an article is about. No AI, so it is fast, free and predictable."],
            ["Judge", "The model sees numbered sentences and answers with sentence IDs. Code looks the text up, so evidence is always the article's own words."],
            ["Score", "A fixed formula turns stances into a daily mood: one vote per outlet per story, recent news weighted more."],
            ["Say unsure", "When the text does not point either way, the answer is “unclear”, and it never moves the mood."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-4">
              <span className="tabular font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="font-medium">{t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Disclaimer className="text-center" />
    </div>
  );
}
