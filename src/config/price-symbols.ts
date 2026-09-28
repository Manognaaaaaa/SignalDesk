/**
 * Asset slug -> Deriv market-data symbol, for the mood-vs-price chart. Only assets Deriv's
 * public API actually lists (checked 2026-09-28 with active_symbols) are mapped; the rest show
 * mood only. Index symbols are Deriv's OTC prices, which track the named index but are not the
 * exchange's official level - the chart says so.
 */
export type PriceSymbol = { symbol: string; label: string; otc?: boolean };

export const PRICE_SYMBOLS: Record<string, PriceSymbol> = {
  "eur-usd": { symbol: "frxEURUSD", label: "EUR/USD" },
  "gbp-usd": { symbol: "frxGBPUSD", label: "GBP/USD" },
  "usd-jpy": { symbol: "frxUSDJPY", label: "USD/JPY" },
  "aud-usd": { symbol: "frxAUDUSD", label: "AUD/USD" },
  "usd-cad": { symbol: "frxUSDCAD", label: "USD/CAD" },
  "usd-chf": { symbol: "frxUSDCHF", label: "USD/CHF" },
  gold: { symbol: "frxXAUUSD", label: "Gold/USD" },
  silver: { symbol: "frxXAGUSD", label: "Silver/USD" },
  "sp-500": { symbol: "OTC_SPC", label: "US 500", otc: true },
  nasdaq: { symbol: "OTC_NDX", label: "US Tech 100", otc: true },
  "dow-jones": { symbol: "OTC_DJI", label: "Wall Street 30", otc: true },
  "ftse-100": { symbol: "OTC_FTSE", label: "UK 100", otc: true },
  dax: { symbol: "OTC_GDAXI", label: "Germany 40", otc: true },
  "nikkei-225": { symbol: "OTC_N225", label: "Japan 225", otc: true },
  bitcoin: { symbol: "cryBTCUSD", label: "BTC/USD" },
  ethereum: { symbol: "cryETHUSD", label: "ETH/USD" },
};
