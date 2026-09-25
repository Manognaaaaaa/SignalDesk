/**
 * Sentence splitting with stable IDs. The title is always S1; excerpt sentences follow as
 * S2..Sn. These IDs are what the LLM cites, and what code uses to look evidence back up.
 */

export type Sentence = { id: string; text: string };
export const SENTENCE_MAX = 400;

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** Splits text into trimmed, non-empty sentences (each capped at 400 chars). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) {
    const s = segment.replace(/\s+/g, " ").trim();
    if (s) out.push(s.length > SENTENCE_MAX ? `${s.slice(0, SENTENCE_MAX - 1)}…` : s);
  }
  return out;
}

/** Title = S1, then the excerpt's sentences. Duplicate of the title in the excerpt is skipped. */
export function buildSentences(title: string, excerpt: string): Sentence[] {
  const t = title.replace(/\s+/g, " ").trim().slice(0, SENTENCE_MAX);
  const rest = splitSentences(excerpt).filter((s) => s.toLowerCase() !== t.toLowerCase());
  return [t, ...rest].filter(Boolean).map((text, i) => ({ id: `S${i + 1}`, text }));
}
