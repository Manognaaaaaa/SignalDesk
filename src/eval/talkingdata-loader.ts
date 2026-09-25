import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { z } from "zod";
import type { DetectionEvent, DetectionLink } from "@/lib/detection/types";

/**
 * Streaming loader for the Kaggle "TalkingData AdTracking Fraud Detection" CSV (train_sample.csv).
 * The file is licensed competition data: it is never committed or redistributed (data/ is
 * gitignored) and whoever downloads it must accept the competition rules.
 *
 * Mapping to the detection model:
 *   channel      -> one replay link  "td-ch-<channel>"
 *   ip           -> ip_hash = sha256(salt + "td:" + ip)   (raw IPs are hashed immediately)
 *   is_attributed=1 -> converted_signup (the dataset has conversions, NOT fraud labels)
 *   country / user agent -> unknown (null), so BOT_SHARE and GEO_MISMATCH cannot apply.
 * Malformed rows are skipped and counted; a single bad row never fails the load.
 */

export const TD_COLUMNS = ["ip", "app", "device", "os", "channel", "click_time", "attributed_time", "is_attributed"] as const;

const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const intStr = z.string().regex(/^\d{1,10}$/);

export const tdRowSchema = z.object({
  ip: intStr,
  app: intStr,
  device: intStr,
  os: intStr,
  channel: intStr,
  click_time: z.string().regex(TS),
  attributed_time: z.union([z.literal(""), z.string().regex(TS)]),
  is_attributed: z.enum(["0", "1"]),
});

export type ReplayEvent = DetectionEvent & { channel: string; attributed_at: Date | null };

export type TalkingDataLoad = {
  events: ReplayEvent[];
  links: DetectionLink[];
  rows_read: number;
  rows_valid: number;
  rows_malformed: number;
};

const toUtc = (s: string) => new Date(`${s.replace(" ", "T")}Z`);

export function tdIpHash(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}td:${ip}`).digest("hex");
}

export const replaySlug = (channel: string) => `td-ch-${channel}`;

/** Validates the header row exactly; throws a clear error for e.g. the Kaggle test.csv layout. */
export function checkHeader(header: string[]): void {
  const h = header.map((x) => x.trim());
  if (h.length !== TD_COLUMNS.length || TD_COLUMNS.some((c, i) => h[i] !== c)) {
    throw new Error(`unexpected CSV header: expected ${TD_COLUMNS.join(",")}`);
  }
}

export async function loadTalkingData(path: string, opts: { salt: string; maxRows: number }): Promise<TalkingDataLoad> {
  const parser = createReadStream(path).pipe(
    parse({
      columns: (header: string[]) => {
        checkHeader(header);
        return header.map((x) => x.trim());
      },
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }),
  );
  const events: ReplayEvent[] = [];
  const channels = new Set<string>();
  let read = 0;
  let malformed = 0;
  for await (const record of parser as AsyncIterable<Record<string, string>>) {
    if (read >= opts.maxRows) break;
    read++;
    const r = tdRowSchema.safeParse(record);
    if (!r.success) {
      malformed++;
      continue;
    }
    const at = toUtc(r.data.click_time);
    const attributed = r.data.attributed_time ? toUtc(r.data.attributed_time) : null;
    if (Number.isNaN(at.getTime()) || (attributed && Number.isNaN(attributed.getTime()))) {
      malformed++;
      continue;
    }
    const slug = replaySlug(r.data.channel);
    channels.add(r.data.channel);
    events.push({
      link_id: slug,
      channel: r.data.channel,
      at,
      ip_hash: tdIpHash(r.data.ip, opts.salt),
      country_code: null,
      is_bot: null,
      converted_signup: r.data.is_attributed === "1",
      converted_ftd: false,
      attributed_at: r.data.is_attributed === "1" ? (attributed ?? at) : null,
    });
  }
  parser.destroy();
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  const links = [...channels].sort((a, b) => Number(a) - Number(b)).map((c) => ({ id: replaySlug(c), target_countries: [] as string[] }));
  return { events, links, rows_read: read, rows_valid: events.length, rows_malformed: malformed };
}
