/**
 * npm run prices                      -> one normal prices step (the 2 most out-of-date symbols)
 * npm run prices -- --backfill        -> every mapped symbol, 180 daily candles each (~1 min)
 * npm run prices -- --backfill --days 365
 * npm run prices -- --backfill --only bitcoin,gold   -> just these slugs
 * Uses Deriv's public market-data API (no key) and the service role to write daily_prices.
 */
import { PRICE_SYMBOLS } from "@/config/price-symbols";
import { runPriceStep } from "@/lib/jobs/price-job";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseArgs } from "./lib/env";

async function main() {
  const args = parseArgs();
  const db = supabaseAdmin();
  const days = Number(args.days ?? 180);
  if (args.backfill && !(Number.isInteger(days) && days > 0 && days <= 1000)) {
    console.error("--days must be an integer between 1 and 1000");
    process.exit(1);
  }
  const t0 = Date.now();
  const only = typeof args.only === "string" ? args.only.split(",").map((x) => x.trim()) : null;
  const slugs = only ?? Object.keys(PRICE_SYMBOLS);
  const stats = args.backfill ? await runPriceStep(db, { slugs, candles: days }) : await runPriceStep(db);
  console.log(`${stats.symbols.length} symbols, ${stats.rows_upserted} rows upserted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const errs = Object.entries(stats.errors);
  if (errs.length) {
    console.log(`Errors: ${errs.map(([s, e]) => `${s} ${e}`).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`prices failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
