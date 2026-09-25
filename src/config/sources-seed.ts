/**
 * RSS/Atom feeds SignalDesk reads. Each one was fetched once before seeding (see README
 * "Sources") and kept only if it returned valid RSS/Atom with items from the last 7 days.
 * The ingest job fetches ONLY feed URLs stored in the sources table.
 */
export type SourceSeed = { name: string; feed_url: string; site_domain: string; kind: "central_bank" | "news" | "markets" };

export const SOURCES: SourceSeed[] = [
  { name: "Federal Reserve", feed_url: "https://www.federalreserve.gov/feeds/press_all.xml", site_domain: "federalreserve.gov", kind: "central_bank" },
  { name: "European Central Bank", feed_url: "https://www.ecb.europa.eu/rss/press.html", site_domain: "ecb.europa.eu", kind: "central_bank" },
  { name: "Bank of England", feed_url: "https://www.bankofengland.co.uk/rss/news", site_domain: "bankofengland.co.uk", kind: "central_bank" },
  { name: "CNBC Finance", feed_url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", site_domain: "cnbc.com", kind: "markets" },
  { name: "CNBC Economy", feed_url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", site_domain: "cnbc.com", kind: "news" },
  { name: "MarketWatch Top Stories", feed_url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", site_domain: "marketwatch.com", kind: "markets" },
  { name: "FXStreet", feed_url: "https://www.fxstreet.com/rss/news", site_domain: "fxstreet.com", kind: "markets" },
  { name: "CoinDesk", feed_url: "https://www.coindesk.com/arc/outboundfeeds/rss/", site_domain: "coindesk.com", kind: "markets" },
  { name: "OilPrice.com", feed_url: "https://oilprice.com/rss/main", site_domain: "oilprice.com", kind: "markets" },
  { name: "BBC Business", feed_url: "https://feeds.bbci.co.uk/news/business/rss.xml", site_domain: "bbc.co.uk", kind: "news" },
];
