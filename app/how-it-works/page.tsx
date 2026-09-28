import { Disclaimer } from "@/components/Disclaimer";
import { StanceBadge } from "@/components/StanceBadge";
import { MOOD_CONFIG } from "@/config/mood";

import { GLOSSARY } from "@/lib/mood/labels";

export const metadata = { title: "How it works" };

const STEPS = [
  ["Fetch", "Every 2 hours, public RSS feeds from central banks and market news sites are fetched safely."],
  ["Group", "Headlines about the same story from different outlets are grouped by title similarity."],
  ["Detect", "A curated list of names and tickers finds which assets each article mentions. No AI here."],
  ["Judge", "An AI reads only the numbered sentences about one asset and picks a stance, citing sentence IDs."],
  ["Score", "A fixed formula turns stances into a daily mood per asset, with an honest confidence level."],
  ["Brief", "Your brief summarises your watchlist. Every line cites its articles; advice words are blocked."],
] as const;

/** Public explainer: pipeline, stance labels, mood formula, confidence rules, limitations. */
export default function HowItWorksPage() {
  const c = MOOD_CONFIG.confidence;
  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">How SignalDesk works</h1>
        <p className="mt-3 max-w-[60ch] text-lg leading-relaxed text-muted">Deterministic where possible, AI only where it adds value, and every claim backed by the sentences it came from.</p>
      </div>

      <section aria-labelledby="pipeline">
        <h2 id="pipeline" className="text-lg font-semibold tracking-tight">The pipeline</h2>
        <ol className="mt-4 grid gap-px overflow-hidden rounded-xl border border-line/70 bg-line/70 sm:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="relative bg-surface p-5">
              <span className="tabular font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-1 font-semibold">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-sm text-muted">All of this runs in the background. Pages only read results that are already computed, so you never wait for fetching or AI.</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight">Stance labels</h2>
        <p className="mt-1 text-sm text-muted">Labels fit the asset type. Central banks are hawkish or dovish; currencies, commodities, indices, stocks and crypto are bullish or bearish.</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {(["bullish", "bearish", "hawkish", "dovish", "neutral", "unclear"] as const).map((s) => (
            <div key={s} className="flex items-start gap-3 rounded-lg border border-line/70 bg-surface p-3">
              <dt>
                <StanceBadge stance={s} />
              </dt>
              <dd className="text-sm text-muted">{GLOSSARY[s]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight">Evidence you can check</h2>
        <p className="mt-1 text-sm text-muted">
          The AI never writes quotes. It sees sentences numbered S1, S2 and so on, and answers with sentence IDs. SignalDesk looks those IDs up in its own stored copy, so
          the highlighted evidence is always the article&apos;s real text. An answer that cites a sentence that does not exist is rejected.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight">The daily mood formula</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Each stance becomes a number: bullish or hawkish = +1, bearish or dovish = −1, neutral = 0. Unclear and failed stances are left out.</li>
          <li>One vote per story per source, so an outlet repeating a story does not count twice.</li>
          <li>Each vote&apos;s weight = strength / 3 × recency (halves every {MOOD_CONFIG.halfLifeHours} hours) × 1 / (votes from that source that day).</li>
          <li>Score = weighted average, kept between −1 and +1.</li>
          <li>Agreement = share of votes pointing the same way as the score.</li>
        </ol>
        <h3 className="mt-6 font-semibold">Confidence</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>High: at least {c.highMinSources} different sources and agreement of {Math.round(c.highMinAgreement * 100)}% or more.</li>
          <li>Medium: at least {c.mediumMinSources} different sources.</li>
          <li>Low: anything else. A low-confidence mood is a hint, not a signal.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight">What &quot;unclear&quot; means</h2>
        <p className="mt-1 text-sm text-muted">
          When the sentences do not clearly say which way an asset is pushed, SignalDesk says &quot;unclear&quot; instead of guessing. Unclear stances never move the mood score.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight">Limitations</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>RSS feeds carry only a headline and a short summary, so stances are based on a few sentences.</li>
          <li>Name matching misses indirect mentions (e.g. &quot;the world&apos;s largest chipmaker&quot;) and can catch loose ones (e.g. &quot;the euro area&quot;).</li>
          <li>Stance describes what the news says, not what prices did. It is not price data.</li>
          <li>English sources only.</li>
        </ul>
      </section>
      <Disclaimer />
    </div>
  );
}
