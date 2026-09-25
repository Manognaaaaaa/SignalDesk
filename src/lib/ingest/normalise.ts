import { createHash } from "node:crypto";

/**
 * Turns raw feed items into safe, compact article rows. We keep only a title and a short
 * excerpt (<= 500 chars) and always link to the original - never the full article.
 */

export const MAX_AGE_MS = 7 * 86_400_000;
export const EXCERPT_MAX = 500;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

/** Decodes the common named and numeric HTML entities. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Removes tags (incl. script/style content), decodes entities and collapses whitespace. */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  const noBlocks = input.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const noTags = noBlocks.replace(/<[^>]*>/g, " ");
  // Decode after stripping so encoded "&lt;b&gt;" stays literal text, then drop any tag it produced.
  return decodeEntities(noTags).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Canonical article URL: http/https only, lower-case host, no fragment, no utm_* / click-id
 * tracking parameters. Returns null for anything else (javascript:, data:, relative, ...).
 */
export function canonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(k) || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(k.toLowerCase())) u.searchParams.delete(k);
  }
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

export const urlHash = (canonical: string) => createHash("sha256").update(canonical).digest("hex");

export type RawItem = { title?: string | null; link?: string | null; summary?: string | null; date?: string | null };
export type NormalisedArticle = { url: string; url_hash: string; title: string; excerpt: string; published_at: string | null };
export type NormaliseResult = { ok: true; article: NormalisedArticle } | { ok: false; reason: "no_title" | "bad_url" | "too_old" };

/** Cuts text to max chars on a word boundary where possible. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

/** Normalises one feed item; items older than 7 days, without a title or with a bad link are skipped. */
export function normaliseItem(item: RawItem, now: number = Date.now()): NormaliseResult {
  const title = truncate(stripHtml(item.title), 500);
  if (!title) return { ok: false, reason: "no_title" };
  const url = canonicalUrl(item.link);
  if (!url) return { ok: false, reason: "bad_url" };
  const t = item.date ? Date.parse(item.date) : NaN;
  const published = Number.isFinite(t) ? Math.min(t, now) : null; // future dates are clamped to now
  if (published !== null && now - published > MAX_AGE_MS) return { ok: false, reason: "too_old" };
  return {
    ok: true,
    article: {
      url,
      url_hash: urlHash(url),
      title,
      excerpt: truncate(stripHtml(item.summary), EXCERPT_MAX),
      published_at: published === null ? null : new Date(published).toISOString(),
    },
  };
}
