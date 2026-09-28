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
  // ---- Added 2026-09-28: wider catalogue. Aliases stay conservative (whole words, case-sensitive
  // where a name is also an everyday word) because a false match costs a stance call.
  {
    slug: "aud-usd",
    name: "AUD/USD",
    asset_type: "currency_pair",
    description_simple: "How many US dollars one Australian dollar buys. Often moves with commodity prices and China.",
    aliases: [{ alias: "AUD/USD" }, { alias: "AUDUSD" }, { alias: "Australian dollar" }, { alias: "Aussie dollar" }],
  },
  {
    slug: "usd-cad",
    name: "USD/CAD",
    asset_type: "currency_pair",
    description_simple: "How many Canadian dollars one US dollar buys. Up means the US dollar is stronger.",
    aliases: [{ alias: "USD/CAD" }, { alias: "USDCAD" }, { alias: "Canadian dollar" }, { alias: "loonie" }],
  },
  {
    slug: "usd-chf",
    name: "USD/CHF",
    asset_type: "currency_pair",
    description_simple: "How many Swiss francs one US dollar buys. The franc is a classic safe haven.",
    aliases: [{ alias: "USD/CHF" }, { alias: "USDCHF" }, { alias: "Swiss franc" }],
  },
  {
    slug: "dxy",
    name: "US Dollar Index",
    asset_type: "index",
    description_simple: "The US dollar against a basket of six major currencies. Up means the dollar is broadly stronger.",
    aliases: [{ alias: "US Dollar Index" }, { alias: "U.S. Dollar Index" }, { alias: "Dollar Index" }, { alias: "DXY", cs: true }, { alias: "greenback" }],
  },
  {
    slug: "natural-gas",
    name: "Natural gas",
    asset_type: "commodity",
    description_simple: "Fuel for heating and power plants. Prices swing with weather, storage levels and LNG exports.",
    aliases: [{ alias: "natural gas" }, { alias: "nat gas" }, { alias: "Henry Hub", cs: true }, { alias: "TTF", cs: true }],
  },
  {
    slug: "copper",
    name: "Copper",
    asset_type: "commodity",
    description_simple: "Industrial metal used in wiring and construction; often read as a gauge of global growth.",
    aliases: [{ alias: "copper" }, { alias: "HG=F", cs: true }],
  },
  {
    slug: "dow-jones",
    name: "Dow Jones",
    asset_type: "index",
    description_simple: "An index of 30 large US companies, the oldest widely followed US stock average.",
    aliases: [{ alias: "Dow Jones" }, { alias: "the Dow", cs: true }, { alias: "DJIA", cs: true }, { alias: "Dow Jones Industrial Average" }],
  },
  {
    slug: "ftse-100",
    name: "FTSE 100",
    asset_type: "index",
    description_simple: "An index of the 100 largest companies listed in London.",
    aliases: [{ alias: "FTSE 100" }, { alias: "FTSE", cs: true }, { alias: "Footsie" }],
  },
  {
    slug: "dax",
    name: "DAX",
    asset_type: "index",
    description_simple: "Germany's main stock index of 40 large companies.",
    aliases: [{ alias: "DAX", cs: true }, { alias: "DAX 40", cs: true }],
  },
  {
    slug: "nikkei-225",
    name: "Nikkei 225",
    asset_type: "index",
    description_simple: "Japan's best-known stock index of 225 large companies.",
    aliases: [{ alias: "Nikkei 225" }, { alias: "Nikkei average" }, { alias: "Nikkei index" }, { alias: "the Nikkei", cs: true }],
  },
  {
    slug: "microsoft",
    name: "Microsoft",
    asset_type: "stock",
    description_simple: "Maker of Windows, Office and the Azure cloud; a major AI investor.",
    aliases: [{ alias: "Microsoft" }, { alias: "MSFT", cs: true }],
  },
  {
    slug: "amazon",
    name: "Amazon",
    asset_type: "stock",
    description_simple: "Online retailer and owner of AWS, the largest cloud-computing business.",
    aliases: [{ alias: "Amazon", cs: true }, { alias: "AMZN", cs: true }, { alias: "Amazon Web Services" }],
  },
  {
    slug: "alphabet",
    name: "Alphabet",
    asset_type: "stock",
    description_simple: "Google's parent company: search, YouTube, Android and Google Cloud.",
    aliases: [{ alias: "Alphabet", cs: true }, { alias: "Google", cs: true }, { alias: "GOOGL", cs: true }, { alias: "GOOG", cs: true }],
  },
  {
    slug: "meta",
    name: "Meta",
    asset_type: "stock",
    description_simple: "Owner of Facebook, Instagram and WhatsApp.",
    aliases: [{ alias: "Meta Platforms" }, { alias: "Meta", cs: true }, { alias: "META", cs: true }],
  },
  {
    slug: "amd",
    name: "AMD",
    asset_type: "stock",
    description_simple: "Chipmaker competing with Intel in processors and with Nvidia in AI accelerators.",
    aliases: [{ alias: "AMD", cs: true }, { alias: "Advanced Micro Devices" }],
  },
  {
    slug: "tsmc",
    name: "TSMC",
    asset_type: "stock",
    description_simple: "Taiwan's contract chipmaker that manufactures chips for Apple, Nvidia and others.",
    aliases: [{ alias: "TSMC", cs: true }, { alias: "Taiwan Semiconductor" }],
  },
  {
    slug: "micron",
    name: "Micron",
    asset_type: "stock",
    description_simple: "US maker of memory chips, which AI data centres need in large amounts.",
    aliases: [{ alias: "Micron", cs: true }, { alias: "Micron Technology" }],
  },
  {
    slug: "jpmorgan",
    name: "JPMorgan Chase",
    asset_type: "stock",
    description_simple: "The largest US bank by assets.",
    aliases: [{ alias: "JPMorgan Chase" }, { alias: "JPMorgan" }, { alias: "JPM", cs: true }],
  },
  {
    slug: "solana",
    name: "Solana",
    asset_type: "crypto",
    description_simple: "A fast blockchain network; its coin is SOL.",
    aliases: [{ alias: "Solana" }, { alias: "SOL", cs: true }],
  },
  {
    slug: "xrp",
    name: "XRP",
    asset_type: "crypto",
    description_simple: "The coin linked to Ripple's payments network.",
    aliases: [{ alias: "XRP", cs: true }, { alias: "XRP/USD" }],
  },
  {
    slug: "boj",
    name: "Bank of Japan",
    asset_type: "central_bank",
    description_simple: "Japan's central bank. It sets Japanese interest rates and can intervene in the yen.",
    aliases: [{ alias: "Bank of Japan" }, { alias: "BoJ", cs: true }, { alias: "BOJ", cs: true }, { alias: "Ueda", cs: true }],
  },
  {
    slug: "rba",
    name: "Reserve Bank of Australia",
    asset_type: "central_bank",
    description_simple: "Australia's central bank. It sets Australian interest rates.",
    aliases: [{ alias: "Reserve Bank of Australia" }, { alias: "RBA", cs: true }, { alias: "Michele Bullock" }],
  },
  {
    slug: "boc",
    name: "Bank of Canada",
    asset_type: "central_bank",
    description_simple: "Canada's central bank. It sets Canadian interest rates.",
    aliases: [{ alias: "Bank of Canada" }, { alias: "Tiff Macklem" }],
  },
  {
    slug: "snb",
    name: "Swiss National Bank",
    asset_type: "central_bank",
    description_simple: "Switzerland's central bank. It sets Swiss rates and manages the franc.",
    aliases: [{ alias: "Swiss National Bank" }, { alias: "SNB", cs: true }],
  },
];

/** Assets shown on the public landing page demo card. */
export const DEMO_ASSET_SLUGS = ["gold", "eur-usd", "fed"] as const;
