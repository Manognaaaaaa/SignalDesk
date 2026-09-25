import type { SentenceRow } from "@/lib/ui-types";

/**
 * The stored sentences for an (article, asset), with the evidence sentences highlighted.
 * Text comes from the database by sentence ID - the model never supplies quote text.
 */
export function EvidenceSentences({ sentences, evidenceIds }: { sentences: SentenceRow[]; evidenceIds: string[] }) {
  const ev = new Set(evidenceIds);
  return (
    <ol className="space-y-1.5">
      {sentences.map((s) => {
        const hit = ev.has(s.id);
        return (
          <li
            key={s.id}
            className={`rounded-md px-2 py-1.5 text-sm leading-relaxed ${
              hit ? "border-l-4 border-amber-400 bg-amber-50 text-slate-900 dark:bg-amber-950/40 dark:text-amber-50" : "text-slate-600 dark:text-slate-300"
            }`}
          >
            <span className="mr-2 font-mono text-[10px] text-slate-400">{s.id}</span>
            {s.text}
            {hit && <span className="ml-2 rounded bg-amber-200 px-1 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-800 dark:text-amber-100">evidence</span>}
          </li>
        );
      })}
    </ol>
  );
}
