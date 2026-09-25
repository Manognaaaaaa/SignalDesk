/**
 * Seeded pseudo-random number generation (mulberry32). Every simulation and evaluation run is
 * reproducible from its seed, which is what makes published evaluation numbers verifiable.
 * NOT cryptographically secure - never use it for secrets or IDs that must be unguessable.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [min, max). */
export const uniform = (rng: Rng, min: number, max: number) => min + (max - min) * rng();

/** Uniform integer in [min, max] inclusive. */
export const randInt = (rng: Rng, min: number, max: number) => Math.floor(uniform(rng, min, max + 1));

/** Random element of a non-empty array. */
export function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

/** Poisson sample (Knuth for small means, normal approximation for large ones). */
export function poisson(rng: Rng, mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 50) {
    const u = 1 - rng();
    const v = rng();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * z));
  }
  const l = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > l);
  return k - 1;
}

/** Deterministic UUID-shaped id from the rng (for simulated rows; not a security token). */
export function seededUuid(rng: Rng): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
