/** Client-safe formatting helpers. */

/** Only http/https links are ever rendered; anything else (javascript:, data:, ...) becomes null. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "time unknown";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "time unknown";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const ASSET_TYPE_LABEL: Record<string, string> = {
  currency_pair: "Currencies",
  commodity: "Commodities",
  index: "Stock indices",
  stock: "Stocks",
  crypto: "Crypto",
  central_bank: "Central banks",
};
