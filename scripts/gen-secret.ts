/**
 * Prints fresh 32-byte random secrets (hex) for CRON_SECRET, CONVERSION_WEBHOOK_SECRET and
 * IP_HASH_SALT. Paste them into .env.local / Vercel / Vault - never into tracked files.
 */
import { randomBytes } from "node:crypto";

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["CRON_SECRET", "CONVERSION_WEBHOOK_SECRET", "IP_HASH_SALT"];
for (const name of names) console.log(`${name}=${randomBytes(32).toString("hex")}`);
