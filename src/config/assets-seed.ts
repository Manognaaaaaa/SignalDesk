/**
 * The asset catalogue: the ONLY place assets and their aliases are defined.
 * Asset detection is deterministic alias matching (fast, free, predictable). Aliases always
 * match whole words; `cs: true` makes an alias case-sensitive (tickers, names that are also
 * common words in lower case, e.g. "Fed" vs "fed", "Apple" vs "apple").
 * supabase/migrations/003_seed_assets.sql is generated from this file and a test keeps them in sync.
 */

export type AssetType = "currency_pair" | "commodity" | "index" | "stock" | "crypto" | "central_bank";
export type AliasSeed = { alias: string; cs?: boolean };
export type AssetSeed = { slug: string; name: string; asset_type: AssetType; description_simple: string; aliases: AliasSeed[] };

export const ASSETS: AssetSeed[] = [
  {
    slug: "eur-usd",
    name: "EUR/USD",
    asset_type: "currency_pair",
    description_simple: "How many US dollars one euro buys. Up means the euro is getting stronger against the dollar.",
    aliases: [{ alias: "EUR/USD" }, { alias: "EURUSD" }, { alias: "euro-dollar" }, { alias: "euro against the dollar" }, { alias: "the euro" }],
  },
  {
    slug: "gbp-usd",
    name: "GBP/USD",
    asset_type: "currency_pair",
    description_simple: "How many US dollars one British pound buys. Up means sterling is getting stronger.",
    aliases: [{ alias: "GBP/USD" }, { alias: "GBPUSD" }, { alias: "sterling" }, { alias: "British pound" }, { alias: "the pound" }],
  },
  {
    slug: "usd-jpy",
    name: "USD/JPY",
    asset_type: "currency_pair",
    description_simple: "How many Japanese yen one US dollar buys. Up means the dollar is stronger and the yen weaker.",
    aliases: [{ alias: "USD/JPY" }, { alias: "USDJPY" }, { alias: "Japanese yen" }, { alias: "the yen" }, { alias: "dollar-yen" }],
  },
  {
    slug: "gold",
    name: "Gold",
    asset_type: "commodity",
    description_simple: "The precious metal, often bought as a safe place for money when markets are nervous.",
    aliases: [{ alias: "gold" }, { alias: "XAU" }, { alias: "XAU/USD" }, { alias: "bullion" }, { alias: "gold prices" }],
  },
  {
    slug: "silver",
    name: "Silver",
    asset_type: "commodity",
    description_simple: "A precious metal also used heavily in industry, such as solar panels and electronics.",
    aliases: [{ alias: "silver" }, { alias: "XAG" }, { alias: "XAG/USD" }],
  },
  {
    slug: "oil",
    name: "Crude oil",
    asset_type: "commodity",
    description_simple: "The price of crude oil (Brent and WTI benchmarks), driven by supply, demand and OPEC decisions.",
    aliases: [{ alias: "crude oil" }, { alias: "oil prices" }, { alias: "crude" }, { alias: "Brent", cs: true }, { alias: "WTI", cs: true }, { alias: "OPEC", cs: true }],
  },
  {
    slug: "sp-500",
    name: "S&P 500",
    asset_type: "index",
    description_simple: "An index of 500 large US companies, the most watched measure of the US stock market.",
    aliases: [{ alias: "S&P 500" }, { alias: "S&P500" }, { alias: "SPX", cs: true }, { alias: "Standard & Poor's 500" }],
  },
  {
    slug: "nasdaq",
    name: "Nasdaq",
    asset_type: "index",
    description_simple: "A US stock index dominated by technology companies.",
    aliases: [{ alias: "Nasdaq" }, { alias: "Nasdaq Composite" }, { alias: "Nasdaq 100" }, { alias: "NDX", cs: true }],
  },
  {
    slug: "nvidia",
    name: "NVIDIA",
    asset_type: "stock",
    description_simple: "Chipmaker whose graphics processors power much of today's AI.",
    aliases: [{ alias: "Nvidia" }, { alias: "NVDA", cs: true }],
  },
  {
    slug: "apple",
    name: "Apple",
    asset_type: "stock",
    description_simple: "Maker of the iPhone, Mac and related services; one of the world's largest companies.",
    aliases: [{ alias: "Apple", cs: true }, { alias: "AAPL", cs: true }, { alias: "iPhone maker" }],
  },
  {
    slug: "tesla",
    name: "Tesla",
    asset_type: "stock",
    description_simple: "Electric-car and battery company.",
    aliases: [{ alias: "Tesla" }, { alias: "TSLA", cs: true }],
  },
  {
    slug: "bitcoin",
    name: "Bitcoin",
    asset_type: "crypto",
    description_simple: "The largest cryptocurrency by market value.",
    aliases: [{ alias: "Bitcoin" }, { alias: "BTC", cs: true }],
  },
  {
    slug: "ethereum",
    name: "Ethereum",
    asset_type: "crypto",
    description_simple: "The second-largest cryptocurrency network; its coin is called ether.",
    aliases: [{ alias: "Ethereum" }, { alias: "Ether", cs: true }, { alias: "ETH", cs: true }],
  },
  {
    slug: "fed",
    name: "Federal Reserve",
    asset_type: "central_bank",
    description_simple: "The US central bank. It sets US interest rates to keep prices stable and jobs strong.",
    aliases: [{ alias: "Federal Reserve" }, { alias: "the Fed" }, { alias: "Fed", cs: true }, { alias: "FOMC", cs: true }, { alias: "Powell", cs: true }],
  },
  {
    slug: "ecb",
    name: "European Central Bank",
    asset_type: "central_bank",
    description_simple: "The central bank for the euro area. It sets interest rates for the countries using the euro.",
    aliases: [{ alias: "European Central Bank" }, { alias: "ECB", cs: true }, { alias: "Lagarde", cs: true }],
  },
  {
    slug: "boe",
    name: "Bank of England",
    asset_type: "central_bank",
    description_simple: "The UK central bank. It sets UK interest rates.",
    aliases: [{ alias: "Bank of England" }, { alias: "BoE", cs: true }, { alias: "Andrew Bailey" }],
  },
];

/** Assets shown on the public landing page demo card. */
export const DEMO_ASSET_SLUGS = ["gold", "eur-usd", "fed"] as const;
