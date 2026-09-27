/**
 * Reproducible stratified sampling for the labelling set. Pure: the sampler script feeds it
 * candidates from the database, tests feed it fixtures.
 *
 * Balance: each pick goes to the asset with the fewest examples so far (existing labelled rows
 * count), and within an asset sources are interleaved, so no asset or outlet dominates.
 * Hard cases: a quota of picks comes from the "hard" pool first (the asset is not in the
 * headline, or the article mentions 3+ assets), where neutral/unclear answers are more likely.
 * Hardness is decided from the text only - never from the model's own stance, so the sample
 * is not biased towards what the model already gets right or wrong.
 */

export type Candidate = { key: string; asset: string; source: string; hard: boolean };

/** mulberry32: tiny seeded PRNG, so the same seed always gives the same sample. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Orders one asset's candidates so consecutive picks rotate through sources. */
function interleaveSources(cs: Candidate[], rand: () => number): Candidate[] {
  const bySource = new Map<string, Candidate[]>();
  for (const c of shuffle(cs, rand)) (bySource.get(c.source) ?? bySource.set(c.source, []).get(c.source)!).push(c);
  const queues = shuffle([...bySource.values()], rand);
  const out: Candidate[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}

/**
 * Picks `n` new candidates. `existing` = asset/hard of rows already in the file, so a top-up
 * keeps the whole set balanced. `hardShare` = target share of hard rows in the whole set.
 */
export function stratifiedSample(
  candidates: Candidate[],
  n: number,
  opts: { seed: number; hardShare: number; existing?: { asset: string; hard: boolean }[] },
): Candidate[] {
  const rand = seededRandom(opts.seed);
  const existing = opts.existing ?? [];
  const counts = new Map<string, number>();
  for (const e of existing) counts.set(e.asset, (counts.get(e.asset) ?? 0) + 1);
  const assetOrder = shuffle([...new Set(candidates.map((c) => c.asset))].sort(), rand);
  for (const a of assetOrder) if (!counts.has(a)) counts.set(a, 0);

  const queues = (pool: Candidate[]) => {
    const m = new Map<string, Candidate[]>();
    for (const a of assetOrder) {
      const cs = pool.filter((c) => c.asset === a);
      if (cs.length) m.set(a, interleaveSources(cs, rand));
    }
    return m;
  };
  const hardQ = queues(candidates.filter((c) => c.hard));
  const easyQ = queues(candidates.filter((c) => !c.hard));

  const total = existing.length + n;
  let hardNeeded = Math.max(0, Math.round(total * opts.hardShare) - existing.filter((e) => e.hard).length);
  const picked: Candidate[] = [];

  const pickFrom = (q: Map<string, Candidate[]>): Candidate | null => {
    let best: string | null = null;
    for (const a of assetOrder) {
      if (!q.get(a)?.length) continue;
      if (best === null || counts.get(a)! < counts.get(best)!) best = a;
    }
    if (best === null) return null;
    counts.set(best, counts.get(best)! + 1);
    return q.get(best)!.shift()!;
  };
  const drop = (c: Candidate) => {
    for (const q of [hardQ, easyQ]) {
      const list = q.get(c.asset);
      const i = list?.findIndex((x) => x.key === c.key) ?? -1;
      if (list && i >= 0) list.splice(i, 1);
    }
  };

  while (picked.length < n) {
    const c = (hardNeeded > 0 ? pickFrom(hardQ) : null) ?? pickFrom(easyQ) ?? pickFrom(hardQ);
    if (!c) break;
    if (c.hard) hardNeeded--;
    drop(c);
    picked.push(c);
  }
  return picked;
}
