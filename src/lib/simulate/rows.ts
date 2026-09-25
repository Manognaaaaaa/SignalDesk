import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SimEvent } from "./generator";
import { pick, type Rng } from "./prng";

/**
 * Turns generator events into database rows (click_events + conversions). Shared by the seed
 * script, the live simulator and the replay loader so every writer produces the same shape.
 * Simulated IP labels are hashed too, so no table ever holds anything that looks like a raw IP.
 */

const HUMAN_UAS = [
  ["Chrome", "mobile"],
  ["Chrome", "desktop"],
  ["Mobile Safari", "mobile"],
  ["Samsung Internet", "mobile"],
  ["Firefox", "desktop"],
  ["Safari", "tablet"],
] as const;

export type ClickRow = {
  id: string;
  link_id: string;
  clicked_at: string;
  ip_hash: string;
  country_code: string | null;
  ua_family: string;
  device_type: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  is_bot: boolean | null;
  referrer_domain: string | null;
  dataset: "simulated" | "replay";
  scenario: string | null;
};

export type ConversionInsert = {
  event_id: string;
  click_id: string;
  link_id: string;
  type: "signup" | "ftd";
  amount_usd: number | null;
  occurred_at: string;
};

/** Stable pseudonymous hash for a synthetic IP label (never a real IP). */
export function simIpHash(label: string): string {
  return createHash("sha256").update(`sim:${label}`).digest("hex");
}

/**
 * Builds rows for a batch of events. Conversions happen shortly after the click and are
 * clamped to `now` so nothing lands in the future.
 */
export function buildRows(
  events: SimEvent[],
  opts: { dataset: "simulated" | "replay"; now: number; rng: Rng; referrer?: (e: SimEvent) => string | null },
): { clicks: ClickRow[]; conversions: ConversionInsert[] } {
  const clicks: ClickRow[] = [];
  const conversions: ConversionInsert[] = [];
  for (const e of events) {
    const id = randomUUID();
    const [family, device] = e.is_bot === true ? (["bot", "bot"] as const) : e.is_bot === null ? (["unknown", "unknown"] as const) : pick(opts.rng, HUMAN_UAS);
    clicks.push({
      id,
      link_id: e.link_id,
      clicked_at: e.at.toISOString(),
      ip_hash: simIpHash(e.ip_hash),
      country_code: e.country_code,
      ua_family: family,
      device_type: device,
      is_bot: e.is_bot,
      referrer_domain: opts.referrer ? opts.referrer(e) : null,
      dataset: opts.dataset,
      scenario: e.scenario,
    });
    if (e.converted_signup) {
      const signupAt = Math.min(opts.now, e.at.getTime() + Math.floor(opts.rng() * 30 * 60_000));
      conversions.push({
        event_id: `sim-${id}-s`,
        click_id: id,
        link_id: e.link_id,
        type: "signup",
        amount_usd: null,
        occurred_at: new Date(signupAt).toISOString(),
      });
      if (e.converted_ftd) {
        const ftdAt = Math.min(opts.now, signupAt + Math.floor(opts.rng() * 24 * 3_600_000));
        conversions.push({
          event_id: `sim-${id}-f`,
          click_id: id,
          link_id: e.link_id,
          type: "ftd",
          amount_usd: Math.round((10 + opts.rng() * 490) * 100) / 100,
          occurred_at: new Date(ftdAt).toISOString(),
        });
      }
    }
  }
  return { clicks, conversions };
}

/** Inserts rows in batches (default 1,000) and throws with the DB error code on failure. */
export async function insertInBatches(db: SupabaseClient, table: string, rows: object[], size = 1000, onProgress?: (done: number) => void): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} insert failed: ${error.code ?? "unknown"} ${error.message.slice(0, 120)}`);
    onProgress?.(Math.min(rows.length, i + size));
  }
}
