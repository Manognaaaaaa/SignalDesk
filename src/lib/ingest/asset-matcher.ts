import type { Sentence } from "./sentences";

/**
 * Deterministic asset detection from the curated alias catalogue (no LLM).
 * Aliases are escaped, matched as WHOLE WORDS (so "gold" never matches "golden"), with flexible
 * whitespace for multi-word aliases, and case-sensitive where the catalogue says so (tickers).
 */

export type AliasRow = { alias: string; is_case_sensitive: boolean };
export type AssetWithAliases = { id: string; aliases: AliasRow[] };
export type CompiledAsset = { id: string; patterns: RegExp[] };
export type Mention = { asset_id: string; sentences: Sentence[] };

export const MAX_MENTION_SENTENCES = 6;

/** Escapes regex metacharacters in alias text ("S&P 500", "EUR/USD", "XAU/USD"...). */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Builds one whole-word regex for an alias. Letters/digits may not touch either end. */
export function aliasPattern(a: AliasRow): RegExp {
  const body = a.alias.trim().split(/\s+/).map(escapeRegex).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, a.is_case_sensitive ? "u" : "iu");
}

/** Precompiles every alias once per job run. */
export function compileMatcher(assets: AssetWithAliases[]): CompiledAsset[] {
  return assets.map((a) => ({ id: a.id, patterns: a.aliases.filter((x) => x.alias.trim()).map(aliasPattern) }));
}

/**
 * For each asset mentioned in the sentences, returns the mentioning sentences plus one neighbour
 * on each side for context, capped at 6 (mentions take priority over neighbours), in text order.
 */
export function matchAssets(sentences: Sentence[], compiled: CompiledAsset[]): Mention[] {
  const out: Mention[] = [];
  for (const asset of compiled) {
    const hits: number[] = [];
    sentences.forEach((s, i) => {
      if (asset.patterns.some((p) => p.test(s.text))) hits.push(i);
    });
    if (hits.length === 0) continue;
    const chosen = new Set<number>();
    for (const i of hits) if (chosen.size < MAX_MENTION_SENTENCES) chosen.add(i);
    for (const i of hits) {
      for (const n of [i - 1, i + 1]) {
        if (chosen.size >= MAX_MENTION_SENTENCES) break;
        if (n >= 0 && n < sentences.length) chosen.add(n);
      }
    }
    out.push({ asset_id: asset.id, sentences: [...chosen].sort((a, b) => a - b).map((i) => sentences[i]!) });
  }
  return out;
}
