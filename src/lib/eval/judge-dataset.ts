import type { AssetType } from "@/config/assets-seed";
import { allowedStances } from "@/lib/ai/prompts";
import type { Sentence } from "@/lib/ingest/sentences";

/**
 * The hand-labelled Judge dataset: eval/judge/labels.csv. The CSV is the frozen source of truth -
 * the eval reads sentences from it, not from the database, so results stay reproducible even
 * after the database changes. The first seven columns are the labelling template; the rest is
 * context for the labeller and for slicing results. `labelled_by` records who set each gold
 * label (e.g. "author", "claude-opus-5.5", "claude-opus-5.5+author-reviewed") so reports can
 * state label provenance honestly.
 */

export const JUDGE_COLUMNS = [
  "example_id",
  "asset",
  "article_id",
  "numbered_sentences",
  "gold_stance",
  "gold_supporting_sentence_ids",
  "notes",
  "asset_type",
  "allowed_stances",
  "source",
  "published_at",
  "bucket",
  "url",
  "labelled_by",
] as const;

export const ASSET_TYPES = ["currency_pair", "commodity", "index", "stock", "crypto", "central_bank"] as const;

/** Gold value for rows that cannot be labelled (broken text, duplicate...): excluded from every metric. */
export const SKIP_LABEL = "skip";

export const formatSentences = (ss: Sentence[]) => ss.map((s) => `[${s.id}] ${s.text}`).join("\n");

export function parseSentences(cell: string): Sentence[] {
  return cell
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^\[(S\d+)\]\s?(.*)$/.exec(l);
      if (!m) throw new Error(`bad sentence line: ${l.slice(0, 60)}`);
      return { id: m[1]!, text: m[2]! };
    });
}

export const parseIds = (cell: string) =>
  cell
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

export type LabelledExample = {
  example_id: string;
  asset: string;
  asset_type: AssetType;
  article_id: string;
  source: string;
  bucket: string;
  sentences: Sentence[];
  gold_stance: string;
  gold_ids: string[];
  labelled_by: string;
};

/**
 * Splits CSV rows into labelled examples, unlabelled rows and problems. Every problem names the
 * example_id so it can be fixed in the spreadsheet; the eval refuses to run while any exist.
 */
export function readLabelled(rows: Record<string, string>[]) {
  const labelled: LabelledExample[] = [];
  const problems: string[] = [];
  let unlabelled = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const id = r.example_id ?? "";
    if (seen.has(id)) problems.push(`${id}: duplicate example_id`);
    seen.add(id);
    const gold = (r.gold_stance ?? "").trim().toLowerCase();
    if (!gold) {
      unlabelled++;
      continue;
    }
    if (gold === SKIP_LABEL) {
      skipped++;
      continue;
    }
    const type = r.asset_type as AssetType;
    if (!ASSET_TYPES.includes(type)) {
      problems.push(`${id}: unknown asset_type "${r.asset_type}"`);
      continue;
    }
    if (!allowedStances(type).includes(gold as never)) {
      problems.push(`${id}: gold_stance "${gold}" is not allowed for ${type} (use ${allowedStances(type).join("/")} or ${SKIP_LABEL})`);
      continue;
    }
    let sentences: Sentence[];
    try {
      sentences = parseSentences(r.numbered_sentences ?? "");
    } catch (e) {
      problems.push(`${id}: ${e instanceof Error ? e.message : "bad numbered_sentences"}`);
      continue;
    }
    const valid = new Set(sentences.map((s) => s.id));
    const goldIds = parseIds(r.gold_supporting_sentence_ids ?? "");
    const bad = goldIds.filter((g) => !valid.has(g));
    if (bad.length) problems.push(`${id}: gold_supporting_sentence_ids ${bad.join(", ")} not in the sentences`);
    if (gold !== "unclear" && goldIds.length === 0) problems.push(`${id}: a ${gold} label needs at least one gold_supporting_sentence_id`);
    labelled.push({ example_id: id, asset: r.asset ?? "", asset_type: type, article_id: r.article_id ?? "", source: r.source ?? "", bucket: r.bucket ?? "", sentences, gold_stance: gold, gold_ids: goldIds, labelled_by: (r.labelled_by ?? "").trim() || "unknown" });
  }
  return { labelled, unlabelled, skipped, problems };
}
