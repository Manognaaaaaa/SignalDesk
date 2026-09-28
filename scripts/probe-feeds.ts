/**
 * npm run probe-feeds [-- --all]
 * Verifies candidate RSS/Atom feeds through the SAME path production uses (safeFetch + parseFeed):
 * HTTP status, parse, item count, items from the last 7 days, newest item. A feed is accepted
 * only if it parses and has at least one item from the last 7 days - the rule used for the
 * original sources (see README "Sources"). By default probes CANDIDATES; --all also re-probes
 * the configured SOURCES. No database access.
 */
import { SOURCES } from "@/config/sources-seed";
import { fetchFeed } from "@/lib/ingest/feeds";
import { parseArgs } from "./lib/env";

export const CANDIDATES: { name: string; feed_url: string }[] = [
  { name: "Federal Reserve speeches", feed_url: "https://www.federalreserve.gov/feeds/speeches.xml" },
  { name: "Bank of Japan", feed_url: "https://www.boj.or.jp/en/rss/whatsnew.xml" },
  { name: "Reserve Bank of Australia", feed_url: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml" },
  { name: "Bank of Canada", feed_url: "https://www.bankofcanada.ca/content_type/press-releases/feed/" },
  { name: "WSJ Markets", feed_url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml" },
  { name: "WSJ World News", feed_url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml" },
  { name: "MarketWatch Real-time", feed_url: "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines" },
  { name: "MarketWatch Bulletins", feed_url: "https://feeds.content.dowjones.io/public/rss/mw_bulletins" },
  { name: "CNBC Markets", feed_url: "https://www.cnbc.com/id/20910258/device/rss/rss.html" },
  { name: "CNBC Investing", feed_url: "https://www.cnbc.com/id/15839069/device/rss/rss.html" },
  { name: "CNBC Top News", feed_url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { name: "CNBC Technology", feed_url: "https://www.cnbc.com/id/19854910/device/rss/rss.html" },
  { name: "Yahoo Finance (big tech tickers)", feed_url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA,AAPL,TSLA,MSFT,AMZN,GOOGL,META&region=US&lang=en-US" },
  { name: "Yahoo Finance (FX, gold, oil)", feed_url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=EURUSD=X,GBPUSD=X,JPY=X,GC=F,CL=F,SI=F&region=US&lang=en-US" },
  { name: "Guardian Business", feed_url: "https://www.theguardian.com/business/rss" },
  { name: "Guardian Economics", feed_url: "https://www.theguardian.com/business/economics/rss" },
  { name: "NYT Business", feed_url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { name: "Cointelegraph", feed_url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", feed_url: "https://decrypt.co/feed" },
  { name: "The Block", feed_url: "https://www.theblock.co/rss.xml" },
  { name: "Investing.com News", feed_url: "https://www.investing.com/rss/news_25.rss" },
  { name: "Investing.com Forex", feed_url: "https://www.investing.com/rss/news_1.rss" },
  { name: "Investing.com Commodities", feed_url: "https://www.investing.com/rss/news_11.rss" },
  { name: "FXEmpire", feed_url: "https://www.fxempire.com/api/v1/en/articles/rss/news" },
  { name: "Mining.com", feed_url: "https://www.mining.com/feed/" },
  { name: "Seeking Alpha Market Currents", feed_url: "https://seekingalpha.com/market_currents.xml" },
  { name: "Nasdaq Markets", feed_url: "https://www.nasdaq.com/feed/rssoutbound?category=Markets" },
  { name: "Fortune Finance", feed_url: "https://fortune.com/section/finance/feed/" },
];

const WEEK = 7 * 86_400_000;

async function main() {
  const args = parseArgs();
  const list = args.all ? [...SOURCES.map((s) => ({ name: s.name, feed_url: s.feed_url })), ...CANDIDATES] : CANDIDATES;
  const rows = await Promise.all(
    list.map(async (c) => {
      const r = await fetchFeed({ id: "probe", feed_url: c.feed_url, etag: null, last_modified: null }, "https://signaldesk-inky.vercel.app");
      if (r.status !== "ok") return { ...c, ok: false, note: r.status === "error" ? r.error : "304" };
      const dates = r.items.map((i) => Date.parse(i.date ?? "")).filter(Number.isFinite);
      const recent = dates.filter((d) => Date.now() - d < WEEK).length;
      const newest = dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 16) : "-";
      return { ...c, ok: recent > 0, note: `http ${r.http} · ${r.items.length} items · ${recent} in 7 d · newest ${newest}`, sample: r.items[0]?.title?.slice(0, 70) ?? "" };
    }),
  );
  for (const r of rows) console.log(`${r.ok ? "ACCEPT" : "reject"}  ${r.name.padEnd(34)} ${r.note}${"sample" in r && r.sample ? `\n        e.g. ${r.sample}` : ""}`);
  console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} accepted`);
}

main().catch((e) => {
  console.error(`probe failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
