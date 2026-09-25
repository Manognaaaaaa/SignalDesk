/**
 * npm run gen-secret [-- NAME ...]
 * Prints fresh 32-byte random secrets (hex). Default: CRON_SECRET. Paste them into .env.local,
 * Vercel and Supabase Vault - never into tracked files.
 */
import { randomBytes } from "node:crypto";

const names = process.argv.slice(2).length ? process.argv.slice(2) : ["CRON_SECRET"];
for (const name of names) console.log(`${name}=${randomBytes(32).toString("hex")}`);
