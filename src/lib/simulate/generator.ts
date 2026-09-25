import type { DetectionEvent, DetectionLink } from "@/lib/detection/types";
import { pick, poisson, randInt, seededUuid, uniform, type Rng } from "./prng";

/**
 * Pure, seeded traffic generator shared by the seed script, the live simulator and the
 * evaluation harness. Same seed -> identical events, so every evaluation number is reproducible.
 *
 * Normal traffic is deliberately noisy (diurnal curve, weekends, legitimate viral bumps) so false
 * alarm rates are measured against realistic noise, not a flat line.
 */

const HOUR = 3_600_000;
const MIN = 60_000;

/** Countries used for targeting and for off-target (mismatched) traffic in simulations. */
export const SIM_TARGET_COUNTRIES = ["NG", "KE", "BR", "ID", "MY", "AE"] as const;
export const SIM_OTHER_COUNTRIES = ["US", "GB", "DE", "FR", "IN", "PK", "VN", "PH", "RU", "CN", "BD", "EG", "MX", "ZA"] as const;

/** A link plus the traffic profile that shapes its simulated normal behaviour. */
export type SimLink = DetectionLink & {
  base_per_hour: number;
  bot_rate: number;
  target_share: number;
  signup_rate: number;
  ftd_rate: number;
};

export type SimEvent = DetectionEvent & { scenario: string | null };

export type AttackKind = "bot_burst" | "click_farm" | "spike" | "slow_drip" | "distributed_bots";
export const DESIGNED_ATTACKS: AttackKind[] = ["bot_burst", "click_farm", "spike"];
/** Held-out kinds: the rules were NOT designed for these and thresholds must never be tuned on them. */
export const HELD_OUT_ATTACKS: AttackKind[] = ["slow_drip", "distributed_bots"];

export type AttackParams = Record<string, number>;

export type AttackLabel = {
  attack_id: string;
  kind: AttackKind;
  link_id: string;
  start: Date;
  end: Date;
  params: AttackParams;
};

/** Random traffic profile for a link: volume 5-60 clicks/hour, 2-5% bots, 85-95% on-target, etc. */
export function withProfile(link: DetectionLink, rng: Rng): SimLink {
  return {
    ...link,
    base_per_hour: uniform(rng, 5, 60),
    bot_rate: uniform(rng, 0.02, 0.05),
    target_share: uniform(rng, 0.85, 0.95),
    signup_rate: uniform(rng, 0.03, 0.08),
    ftd_rate: uniform(rng, 0.25, 0.4),
  };
}

/** Creates n synthetic links (random ids and 1-2 target countries) with traffic profiles. */
export function makeSimLinks(n: number, rng: Rng): SimLink[] {
  return Array.from({ length: n }, () => {
    const a = pick(rng, SIM_TARGET_COUNTRIES);
    const b = pick(rng, SIM_TARGET_COUNTRIES);
    const targets = rng() < 0.5 || a === b ? [a] : [a, b];
    return withProfile({ id: seededUuid(rng), target_countries: targets }, rng);
  });
}

/** Diurnal x weekday multiplier (UTC): quiet nights, busy afternoons, softer weekends. */
export function trafficShape(t: number): number {
  const d = new Date(t);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const diurnal = 0.35 + 0.65 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (h - 4)) / 24));
  const dow = d.getUTCDay();
  return diurnal * (dow === 0 || dow === 6 ? 0.8 : 1.0);
}

/** Expected normal clicks per hour for a link at time t (no bumps). Used to size spikes. */
export function expectedHourly(link: SimLink, t: number): number {
  return link.base_per_hour * trafficShape(t) * 1.5; // 1.5 rescales the shape's mean (~0.63) to ~base
}

function otherCountry(rng: Rng, link: SimLink): string {
  let c = pick(rng, SIM_OTHER_COUNTRIES) as string;
  if (link.target_countries.includes(c)) c = "US";
  return c;
}

function targetCountry(rng: Rng, link: SimLink): string {
  return pick(rng, link.target_countries);
}

/** One human/bot click for a link with its normal conversion behaviour. */
function normalClick(rng: Rng, link: SimLink, at: number, linkIdx: number, pool: number, scenario: string | null): SimEvent {
  const signup = rng() < link.signup_rate;
  return {
    link_id: link.id,
    at: new Date(at),
    ip_hash: `sim-n${linkIdx}-${randInt(rng, 0, pool)}`,
    country_code: rng() < link.target_share ? targetCountry(rng, link) : otherCountry(rng, link),
    is_bot: rng() < link.bot_rate,
    converted_signup: signup,
    converted_ftd: signup && rng() < link.ftd_rate,
    scenario,
  };
}

/**
 * Normal traffic for [from, to): Poisson clicks per hour shaped by time of day and weekday,
 * plus occasional legitimate viral bumps (1.5-2.5x for 1-2 hours, ~8% of link-days).
 */
export function generateNormal(links: SimLink[], from: Date, to: Date, rng: Rng): SimEvent[] {
  const events: SimEvent[] = [];
  const start = Math.floor(from.getTime() / HOUR) * HOUR;
  const end = to.getTime();
  links.forEach((link, linkIdx) => {
    const pool = Math.max(50, Math.round(link.base_per_hour * 24 * 7));
    let bumpStart = Infinity;
    let bumpUntil = -1;
    let bumpFactor = 1;
    for (let h = start; h < end; h += HOUR) {
      if (new Date(h).getUTCHours() === 0 && rng() < 0.08) {
        // schedule a viral bump somewhere in this day
        bumpStart = h + randInt(rng, 8, 20) * HOUR;
        bumpFactor = uniform(rng, 1.5, 2.5);
        bumpUntil = bumpStart + randInt(rng, 1, 2) * HOUR;
      }
      const factor = h >= bumpStart && h < bumpUntil ? bumpFactor : 1;
      const n = poisson(rng, expectedHourly(link, h) * factor);
      for (let i = 0; i < n; i++) {
        const at = h + Math.floor(rng() * HOUR);
        if (at < from.getTime() || at >= end) continue;
        events.push(normalClick(rng, link, at, linkIdx, pool, factor > 1 ? "viral_bump" : null));
      }
    }
  });
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

/** Samples random attack parameters for one trial (ranges documented in README). */
export function sampleAttackParams(kind: AttackKind, rng: Rng): AttackParams {
  switch (kind) {
    case "bot_burst":
      return {
        ip_count: randInt(rng, 1, 3),
        clicks_per_10min: randInt(rng, 15, 80),
        bot_share: uniform(rng, 0.6, 1.0),
        duration_min: randInt(rng, 10, 40),
      };
    case "click_farm":
      return {
        ip_count: randInt(rng, 20, 200),
        off_target_share: uniform(rng, 0.5, 0.95),
        duration_h: randInt(rng, 2, 24),
        clicks_per_hour: randInt(rng, 5, 40),
      };
    case "spike":
      return {
        multiplier: uniform(rng, 3, 15),
        duration_h: randInt(rng, 1, 3),
        bot_share: uniform(rng, 0.05, 0.3),
        off_target_share: uniform(rng, 0.05, 0.3),
      };
    case "slow_drip":
      return { interval_min: uniform(rng, 1, 3), duration_h: 24 };
    case "distributed_bots":
      return {
        ip_count: randInt(rng, 100, 500),
        clicks_per_ip: randInt(rng, 1, 3),
        target_bot_share: uniform(rng, 0.22, 0.29),
        duration_h: 6,
      };
  }
}

/** Duration of an attack in ms, derived from its params. */
export function attackDuration(kind: AttackKind, p: AttackParams): number {
  switch (kind) {
    case "bot_burst":
      return p.duration_min! * MIN;
    default:
      return p.duration_h! * HOUR;
  }
}

type AttackClick = { at: number; ip: string; country: string; is_bot: boolean; signup: boolean; ftd: boolean };

/**
 * Injects one attack of `kind` on `link` starting at `start`. Returns the attack events and a
 * ground-truth label. Attack clicks never convert unless noted (spikes are "mixed quality").
 */
export function injectAttack(
  kind: AttackKind,
  params: AttackParams,
  ctx: { link: SimLink; start: Date },
  rng: Rng,
): { events: SimEvent[]; label: AttackLabel } {
  const { link } = ctx;
  const start = ctx.start.getTime();
  const dur = attackDuration(kind, params);
  const end = start + dur;
  const attackId = seededUuid(rng).slice(0, 8);
  const ipPrefix = `sim-a${attackId}`;
  const clicks: AttackClick[] = [];
  const within = () => start + Math.floor(rng() * dur);

  switch (kind) {
    case "bot_burst": {
      const total = Math.round((params.clicks_per_10min! * params.duration_min!) / 10);
      for (let i = 0; i < total; i++) {
        clicks.push({
          at: within(),
          ip: `${ipPrefix}-${randInt(rng, 1, params.ip_count!)}`,
          country: rng() < 0.5 ? targetCountry(rng, link) : otherCountry(rng, link),
          is_bot: rng() < params.bot_share!,
          signup: false,
          ftd: false,
        });
      }
      break;
    }
    case "click_farm": {
      const total = Math.round(params.clicks_per_hour! * params.duration_h!);
      for (let i = 0; i < total; i++) {
        clicks.push({
          at: within(),
          ip: `${ipPrefix}-${randInt(rng, 1, params.ip_count!)}`,
          country: rng() < params.off_target_share! ? otherCountry(rng, link) : targetCountry(rng, link),
          is_bot: false,
          signup: false,
          ftd: false,
        });
      }
      break;
    }
    case "spike": {
      for (let h = start; h < end; h += HOUR) {
        const span = Math.min(HOUR, end - h);
        const extra = poisson(rng, (params.multiplier! - 1) * expectedHourly(link, h) * (span / HOUR));
        for (let i = 0; i < extra; i++) {
          const signup = rng() < link.signup_rate * 0.5;
          clicks.push({
            at: h + Math.floor(rng() * span),
            ip: `${ipPrefix}-${randInt(rng, 1, 100_000)}`,
            country: rng() < params.off_target_share! ? otherCountry(rng, link) : targetCountry(rng, link),
            is_bot: rng() < params.bot_share!,
            signup,
            ftd: signup && rng() < link.ftd_rate,
          });
        }
      }
      break;
    }
    case "slow_drip": {
      const country = targetCountry(rng, link);
      for (let t = start; t < end; t += params.interval_min! * MIN * uniform(rng, 0.8, 1.2)) {
        clicks.push({ at: Math.floor(t), ip: `${ipPrefix}-1`, country, is_bot: false, signup: false, ftd: false });
      }
      break;
    }
    case "distributed_bots": {
      const total = params.ip_count! * params.clicks_per_ip!;
      const perHour = total / params.duration_h!;
      const normal = expectedHourly(link, start + dur / 2);
      const s = params.target_bot_share!;
      const p = Math.min(1, Math.max(0, (s * (normal + perHour) - link.bot_rate * normal) / perHour));
      for (let ip = 1; ip <= params.ip_count!; ip++) {
        for (let k = 0; k < params.clicks_per_ip!; k++) {
          clicks.push({
            at: within(),
            ip: `${ipPrefix}-${ip}`,
            country: rng() < 0.9 ? targetCountry(rng, link) : otherCountry(rng, link),
            is_bot: rng() < p,
            signup: false,
            ftd: false,
          });
        }
      }
      break;
    }
  }

  const events: SimEvent[] = clicks
    .filter((c) => c.at >= start && c.at < end)
    .map((c) => ({
      link_id: link.id,
      at: new Date(c.at),
      ip_hash: c.ip,
      country_code: c.country,
      is_bot: c.is_bot,
      converted_signup: c.signup,
      converted_ftd: c.ftd,
      scenario: kind,
    }));
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    events,
    label: { attack_id: attackId, kind, link_id: link.id, start: new Date(start), end: new Date(end), params },
  };
}
