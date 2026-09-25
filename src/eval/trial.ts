import {
  attackDuration,
  generateNormal,
  injectAttack,
  makeSimLinks,
  sampleAttackParams,
  type AttackKind,
  type AttackLabel,
  type AttackParams,
  type SimEvent,
  type SimLink,
} from "@/lib/simulate/generator";
import { mulberry32, pick, randInt, type Rng } from "@/lib/simulate/prng";

/**
 * Builds one reproducible evaluation trial: N links with normal traffic over history + test
 * days, and (optionally) one attack at a random time inside the test period.
 */

const DAY = 86_400_000;
const MIN = 60_000;
/** Fixed Monday anchor so runs are reproducible; a random 0-6 day offset varies the weekday. */
const ANCHOR = Date.UTC(2026, 0, 5);

/** Derives an independent 32-bit seed from a base seed and labels (FNV-1a). */
export function seedFor(base: number, ...parts: (string | number)[]): number {
  let h = 0x811c9dc5 ^ base;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Trial = {
  links: SimLink[];
  events: SimEvent[];
  label: AttackLabel | null;
  historyStart: Date;
  testStart: Date;
  testEnd: Date;
  rng: Rng;
};

export function buildTrial(opts: {
  seed: number;
  nLinks: number;
  historyDays?: number;
  testDays?: number;
  attack?: { kind: AttackKind; params?: (rng: Rng, kind: AttackKind) => AttackParams };
}): Trial {
  const rng = mulberry32(opts.seed);
  const historyDays = opts.historyDays ?? 7;
  const testDays = opts.testDays ?? 2;
  const historyStart = new Date(ANCHOR + randInt(rng, 0, 6) * DAY);
  const testStart = new Date(historyStart.getTime() + historyDays * DAY);
  const testEnd = new Date(testStart.getTime() + testDays * DAY);
  const links = makeSimLinks(opts.nLinks, rng);
  const events = generateNormal(links, historyStart, testEnd, rng);

  let label: AttackLabel | null = null;
  if (opts.attack) {
    const { kind } = opts.attack;
    const params = opts.attack.params ? opts.attack.params(rng, kind) : sampleAttackParams(kind, rng);
    const dur = attackDuration(kind, params);
    const slack = Math.max(0, testDays * DAY - dur - 30 * MIN);
    const start = new Date(Math.floor((testStart.getTime() + rng() * slack) / MIN) * MIN);
    const link = pick(rng, links);
    const injected = injectAttack(kind, params, { link, start }, rng);
    label = injected.label;
    for (const e of injected.events) events.push(e);
  }
  return { links, events, label, historyStart, testStart, testEnd, rng };
}
