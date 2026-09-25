import Link from "next/link";
import { AttributionChart, DetectionChart, FalseAlarmChart, SensitivityChart } from "@/components/EvalCharts";
import { SecurityMatrix } from "@/components/SecurityMatrix";
import type {
  EvalRecord,
  FalseAlarmSummary,
  HeldOutSummary,
  LoadTestSummary,
  RandomisedSummary,
  ReplaySummary,
  SecurityCheck,
  SecuritySummary,
  SensitivitySummary,
} from "@/eval/types";
import { loadEvalResults } from "@/lib/eval-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Evaluation - LinkPulse", description: "How well LinkPulse's fraud detection works, measured on data it was not tuned on." };

/** Optional public repo link (README holds the full methodology). */
const REPO_URL = process.env.REPO_URL?.startsWith("https://") ? process.env.REPO_URL : null;
const pct = (x: number | null | undefined, dp = 1) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(dp)}%`);

/** Provenance line: every number is tied to the exact thresholds (config_hash), seed and commit. */
function Meta({ rec }: { rec: EvalRecord }) {
  return (
    <p className="mt-1 font-mono text-[11px] text-slate-500">
      config_hash {rec.config_hash} · seed {rec.seed ?? "-"} · git {rec.git_sha ?? "-"} · run {new Date(rec.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC
    </p>
  );
}

function Section({ title, rec, meaning, limitation, children }: { title: string; rec?: EvalRecord; meaning: string; limitation: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {rec ? <Meta rec={rec} /> : <p className="mt-1 text-xs text-slate-500">No results yet for this suite.</p>}
      {rec && <div className="mt-4">{children}</div>}
      <p className="mt-4 text-sm text-slate-700">
        <span className="font-medium">What this means: </span>
        {meaning}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        <span className="font-medium">Limitations: </span>
        {limitation}
      </p>
    </section>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/**
 * PUBLIC evaluation page (no login). Reads aggregate results from eval_runs with the anon key.
 * All numbers come from `npm run eval`, `npm run loadtest` and `npm run security-check`; nothing
 * on this page is typed in by hand.
 */
export default async function EvaluationPage() {
  const { source, records } = await loadEvalResults();
  const rnd = records.randomised as EvalRecord<RandomisedSummary> | undefined;
  const fa = records.false_alarm as EvalRecord<FalseAlarmSummary> | undefined;
  const sen = records.sensitivity as EvalRecord<SensitivitySummary> | undefined;
  const ho = records.held_out as EvalRecord<HeldOutSummary> | undefined;
  const rp = records.replay as EvalRecord<ReplaySummary> | undefined;
  const lt = records.load_test as EvalRecord<LoadTestSummary> | undefined;
  const sec = records.security as EvalRecord<SecuritySummary, { checks: SecurityCheck[] }> | undefined;
  const worst = (fa?.details as { worst?: { rule_code: string; severity: string; strength: number; during_viral_bump: boolean; evidence: Record<string, unknown> }[] } | undefined)?.worst ?? [];
  const replayOk = rp && !rp.summary.skipped;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header>
        <p className="text-xs text-slate-500">
          <Link href="/dashboard" className="underline">
            LinkPulse
          </Link>{" "}
          / evaluation
        </p>
        <h1 className="mt-1 text-2xl font-semibold">How well does detection work?</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-700">
          Every number below is produced by the <em>same rule code that runs in production</em>, evaluated on randomised attacks, attack-free
          traffic, attacks the rules were never designed for, and real third-party clicks. Results are reproducible from the seed and tied to the
          exact thresholds by config hash. Methodology: see the README section &quot;Evaluation methodology and results&quot;.
        </p>
        <p className="mt-1 text-xs text-slate-500">Source: {source === "none" ? "no results yet" : source}</p>
      </header>

      {source === "none" ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">No results yet. Run <code>npm run eval</code> with a service-role key configured to publish them here.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Card label="Overall detection rate" value={pct(rnd?.summary.overall.rate)} sub={rnd ? `95% CI ${pct(rnd.summary.overall.low)}-${pct(rnd.summary.overall.high)}, ${rnd.summary.overall.trials} randomised attacks` : undefined} />
            <Card label="False alerts per day" value={fa ? String(fa.summary.false_alerts_per_day) : "n/a"} sub={fa ? `${fa.summary.links} links, attack-free traffic` : undefined} />
            <Card label="Median time to detect" value={rnd?.summary.median_ttd_min != null ? `${rnd.summary.median_ttd_min} min` : "n/a"} sub="with a 5-minute detection cron" />
            <Card
              label="Replay: flagged vs unflagged attribution"
              value={replayOk && rp.summary.attribution_ratio != null ? `${rp.summary.attribution_ratio}×` : "n/a"}
              sub={replayOk ? `p = ${rp.summary.z_test?.p_value}` : "TalkingData replay not run"}
            />
            <Card label="Redirect p95 latency" value={lt?.summary.p95_ms != null ? `${lt.summary.p95_ms} ms` : "n/a"} sub={lt ? `${lt.summary.requests_per_sec} req/s, ${lt.summary.url_host}` : undefined} />
            <Card label="Security checks passed" value={sec ? `${sec.summary.passed}/${sec.summary.total}` : "n/a"} sub={sec?.summary.target_host} />
          </div>

          <Section
            title="1. Randomised attacks"
            rec={rnd}
            meaning="Each attack type was injected many times with random size, speed, IP count and countries into noisy normal traffic. The bar is the share of attacks the expected rule caught within the attack window plus 15 minutes; the whisker is the 95% Wilson confidence interval."
            limitation="The attacks and normal traffic come from our own generator, so this measures the rules against the attacks we imagined. Suites 4 and 5 exist to check beyond that."
          >
            {rnd && (
              <>
                <DetectionChart data={rnd.summary.per_kind.map((k) => ({ kind: k.kind, ...k.detection }))} />
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="p-1">Attack</th>
                      <th className="p-1">Detected</th>
                      <th className="p-1">95% CI</th>
                      <th className="p-1">Median / p90 time to detect</th>
                      <th className="p-1">Rules fired</th>
                      <th className="p-1">False alarms / trial</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rnd.summary.per_kind.map((k) => (
                      <tr key={k.kind} className="border-t border-slate-100">
                        <td className="p-1">{k.kind}</td>
                        <td className="p-1">
                          {k.detected}/{k.trials} ({pct(k.detection.rate)})
                        </td>
                        <td className="p-1">
                          {pct(k.detection.low)}-{pct(k.detection.high)}
                        </td>
                        <td className="p-1">
                          {k.median_ttd_min ?? "n/a"} / {k.p90_ttd_min ?? "n/a"} min
                        </td>
                        <td className="p-1 text-xs">{Object.entries(k.rules_fired).map(([r, n]) => `${r} ×${n}`).join(", ") || "-"}</td>
                        <td className="p-1">{k.false_alarms_per_trial}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Section>

          <Section
            title="2. False alarms on attack-free traffic"
            rec={fa}
            meaning="Weeks of normal traffic with legitimate viral bumps and no attacks at all: every alert here is a false alarm, so this is the cost the team pays in wasted investigations."
            limitation="Real traffic has more kinds of legitimate surprises (holidays, TV spots, tracking outages) than the generator's viral bumps."
          >
            {fa && (
              <>
                <p className="text-sm">
                  <strong>{fa.summary.false_alerts_per_day}</strong> false alerts per day across {fa.summary.links} links ({fa.summary.per_link_per_week} per link per week);{" "}
                  {pct(fa.summary.during_viral_bump_share)} fired during a legitimate viral bump.
                </p>
                <FalseAlarmChart data={Object.entries(fa.summary.per_rule_per_day).map(([rule, per_day]) => ({ rule, per_day }))} />
                <h3 className="mt-3 text-sm font-semibold">Worst false alarms</h3>
                <table className="mt-1 w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="p-1">Rule</th>
                      <th className="p-1">Severity</th>
                      <th className="p-1">× threshold</th>
                      <th className="p-1">Viral bump?</th>
                      <th className="p-1">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worst.map((w, i) => (
                      <tr key={i} className="border-t border-slate-100 align-top">
                        <td className="p-1 font-mono text-xs">{w.rule_code}</td>
                        <td className="p-1">{w.severity}</td>
                        <td className="p-1">{w.strength}</td>
                        <td className="p-1">{w.during_viral_bump ? "yes" : "no"}</td>
                        <td className="p-1 font-mono text-[11px]">{JSON.stringify(w.evidence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Section>

          <Section
            title="3. Sensitivity: the smallest attack each rule catches"
            rec={sen}
            meaning="One attack parameter is swept while the others stay random. The breaking point is the lowest intensity from which at least 90% of attacks are caught (dashed line). Attacks below it slip through by design of the thresholds."
            limitation="20 trials per level gives wide intervals; the curve shape matters more than any single point."
          >
            {sen && (
              <div className="grid gap-4 md:grid-cols-3">
                {sen.summary.series.map((s) => (
                  <div key={s.kind}>
                    <h3 className="text-sm font-semibold">{s.kind}</h3>
                    <p className="text-xs text-slate-500">breaking point: {s.breaking_point ?? "not reached"}</p>
                    <SensitivityChart levels={s.levels.map((l) => ({ level: l.level, rate: l.detection.rate }))} breakingPoint={s.breaking_point} parameter={s.parameter} />
                    <p className="text-[11px] text-slate-500">{s.levels.map((l) => `${l.level}: ${pct(l.detection.rate, 0)}`).join(" · ")}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="4. Held-out attacks (the rules were not designed for these)"
            rec={ho}
            meaning="Honest misses. These attack types were kept out of rule design and threshold choice. Any detection here is incidental (usually a volume rule), and the note names the signal the rules lacked."
            limitation="Counting any rule on the attacked link as a detection is generous; the missing-signal notes are the real finding."
          >
            {ho && (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="p-1">Attack</th>
                    <th className="p-1">Detected</th>
                    <th className="p-1">95% CI</th>
                    <th className="p-1">Missing signal</th>
                  </tr>
                </thead>
                <tbody>
                  {ho.summary.per_kind.map((k) => (
                    <tr key={k.kind} className="border-t border-slate-100 align-top">
                      <td className="p-1">{k.kind}</td>
                      <td className="p-1">
                        {k.detected}/{k.trials}
                      </td>
                      <td className="p-1">
                        {pct(k.detection.low)}-{pct(k.detection.high)}
                      </td>
                      <td className="p-1 text-xs">{k.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title="5. Replay of real third-party traffic (TalkingData AdTracking)"
            rec={replayOk ? rp : undefined}
            meaning="Real mobile-ad clicks from a public Kaggle dataset we did not create. It has no fraud labels, only conversions, so we test a proxy: if the rules flag low-quality traffic, flagged clicks should convert far less than unflagged ones. A ratio well below 1 with a small p-value supports that."
            limitation="No fraud labels (proxy only); no country or user agent, so BOT_SHARE and GEO_MISMATCH are not applicable; a random sample is sparse per channel. The data is licensed and never redistributed."
          >
            {replayOk && rp.summary.flagged && rp.summary.unflagged && (
              <>
                <p className="text-sm">
                  {rp.summary.rows_valid?.toLocaleString("en-US")} clicks · {rp.summary.links} channels · alerts:{" "}
                  {Object.entries(rp.summary.alerts_by_rule ?? {}).map(([r, n]) => `${r} ${n}`).join(", ")} · not applicable: {(rp.summary.not_applicable_rules ?? []).join(", ") || "none"} ·
                  flagged share of traffic {pct(rp.summary.coverage_share, 2)}
                </p>
                <AttributionChart flagged={rp.summary.flagged.rate} unflagged={rp.summary.unflagged.rate} />
                <p className="text-sm">
                  Ratio <strong>{rp.summary.attribution_ratio ?? "n/a"}</strong> (z = {rp.summary.z_test?.z}, p = {rp.summary.z_test?.p_value}). IPs that triggered IP_BURST:{" "}
                  {rp.summary.burst_ips?.ips} IPs converting at {pct(rp.summary.burst_ips?.rate, 3)} vs {pct(rp.summary.burst_ips?.other_rate, 3)} for all others.
                </p>
              </>
            )}
          </Section>

          <Section
            title="6. Engineering proof: load test and security checks"
            rec={lt ?? sec}
            meaning="The redirect hot path does no AI or detection work, so it stays fast under load; the security matrix is an automated attack run against the deployed app (open redirects, forged webhooks, RLS isolation, privileged functions, headers)."
            limitation="The load test measures one region from one client machine; network latency to that machine is included in the numbers."
          >
            {lt && (
              <p className="text-sm">
                Load test against {lt.summary.url_host}: {lt.summary.requests.toLocaleString("en-US")} requests, {lt.summary.requests_per_sec} req/s, p50 {lt.summary.p50_ms} ms, p95{" "}
                {lt.summary.p95_ms} ms, p99 {lt.summary.p99_ms} ms, non-302 {lt.summary.non_302}, errors {lt.summary.errors}.
              </p>
            )}
            {sec && (
              <div className="mt-3">
                <p className="text-sm">
                  Security checks: <strong>{sec.summary.passed}/{sec.summary.total}</strong> passed against {sec.summary.target_host}.
                </p>
                <SecurityMatrix checks={sec.details.checks ?? []} />
              </div>
            )}
          </Section>
        </>
      )}
      <p className="text-xs text-slate-500">
        Rule thresholds live in <code>src/config/detection.ts</code>. They were never tuned on held-out attacks or replay results; changing them
        changes the config hash and requires rerunning every suite.{" "}
        {REPO_URL && (
          <a className="underline" href={`${REPO_URL}#evaluation-methodology-and-results`} rel="noopener noreferrer">
            Source and methodology (README)
          </a>
        )}
      </p>
    </main>
  );
}
