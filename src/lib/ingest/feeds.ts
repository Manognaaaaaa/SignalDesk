import Parser from "rss-parser";
import type { RawItem } from "./normalise";
import { safeFetch, SafeFetchError, type SafeFetchDeps, defaultDeps } from "./safe-fetch";

/**
 * Feed fetching and parsing. Feeds are downloaded with safeFetch (never by rss-parser itself)
 * using conditional requests (ETag / Last-Modified) and a clear User-Agent, then parsed as
 * RSS or Atom. One bad feed returns an error result; it never throws into the job.
 */

export type FeedSource = { id: string; feed_url: string; etag: string | null; last_modified: string | null };
export type FeedResult =
  | { status: "ok"; items: RawItem[]; etag: string | null; last_modified: string | null; http: number }
  | { status: "not_modified"; http: 304 }
  | { status: "error"; error: string };

const parser = new Parser();

/** Parses RSS/Atom XML into raw items (title, link, summary, date). */
export async function parseFeed(xml: string): Promise<RawItem[]> {
  const feed = await parser.parseString(xml);
  return (feed.items ?? []).map((i) => ({
    title: i.title ?? null,
    link: i.link ?? null,
    summary: (i.contentSnippet || i.summary || i.content || null) as string | null,
    date: i.isoDate ?? i.pubDate ?? null,
  }));
}

export function userAgent(appBaseUrl: string): string {
  return `SignalDesk/1.0 (+${appBaseUrl}; RSS reader, respects conditional requests)`;
}

/** Fetches and parses one source. Error messages are short codes, never response bodies. */
export async function fetchFeed(src: FeedSource, appBaseUrl: string, deps: SafeFetchDeps = defaultDeps): Promise<FeedResult> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent(appBaseUrl),
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
  };
  if (src.etag) headers["If-None-Match"] = src.etag;
  if (src.last_modified) headers["If-Modified-Since"] = src.last_modified;
  try {
    const res = await safeFetch(src.feed_url, { headers }, deps);
    if (res.status === 304) return { status: "not_modified", http: 304 };
    if (res.status < 200 || res.status >= 300) return { status: "error", error: `http_${res.status}` };
    const items = await parseFeed(res.body);
    return { status: "ok", items, etag: res.headers["etag"] ?? null, last_modified: res.headers["last-modified"] ?? null, http: res.status };
  } catch (e) {
    return { status: "error", error: e instanceof SafeFetchError ? e.code : "parse_error" };
  }
}

/** Runs `fn` over items with at most `limit` in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
