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
  // Added 2026-09-28, each verified with `npm run probe-feeds` (parses, has items from the last 7 days).
  { name: "Federal Reserve speeches", feed_url: "https://www.federalreserve.gov/feeds/speeches.xml", site_domain: "federalreserve.gov", kind: "central_bank" },
  { name: "Bank of Japan", feed_url: "https://www.boj.or.jp/en/rss/whatsnew.xml", site_domain: "boj.or.jp", kind: "central_bank" },
  { name: "Reserve Bank of Australia", feed_url: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml", site_domain: "rba.gov.au", kind: "central_bank" },
  { name: "MarketWatch Bulletins", feed_url: "https://feeds.content.dowjones.io/public/rss/mw_bulletins", site_domain: "marketwatch.com", kind: "markets" },
  { name: "CNBC Technology", feed_url: "https://www.cnbc.com/id/19854910/device/rss/rss.html", site_domain: "cnbc.com", kind: "markets" },
  { name: "Yahoo Finance: big tech", feed_url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA,AAPL,TSLA,MSFT,AMZN,GOOGL,META&region=US&lang=en-US", site_domain: "finance.yahoo.com", kind: "markets" },
  { name: "Yahoo Finance: FX and commodities", feed_url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=EURUSD=X,GBPUSD=X,JPY=X,GC=F,CL=F,SI=F&region=US&lang=en-US", site_domain: "finance.yahoo.com", kind: "markets" },
  { name: "Investing.com News", feed_url: "https://www.investing.com/rss/news_25.rss", site_domain: "investing.com", kind: "markets" },
  { name: "Investing.com Forex", feed_url: "https://www.investing.com/rss/news_1.rss", site_domain: "investing.com", kind: "markets" },
  { name: "Investing.com Commodities", feed_url: "https://www.investing.com/rss/news_11.rss", site_domain: "investing.com", kind: "markets" },
  { name: "Seeking Alpha Market Currents", feed_url: "https://seekingalpha.com/market_currents.xml", site_domain: "seekingalpha.com", kind: "markets" },
  { name: "Cointelegraph", feed_url: "https://cointelegraph.com/rss", site_domain: "cointelegraph.com", kind: "markets" },
  { name: "Decrypt", feed_url: "https://decrypt.co/feed", site_domain: "decrypt.co", kind: "markets" },
  { name: "Guardian Economics", feed_url: "https://www.theguardian.com/business/economics/rss", site_domain: "theguardian.com", kind: "news" },
];
