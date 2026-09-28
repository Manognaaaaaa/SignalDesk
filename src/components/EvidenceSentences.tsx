import type { SentenceRow } from "@/lib/ui-types";

/**
 * The stored sentences for an (article, asset), with the evidence sentences highlighted like a
 * marker pen. Text comes from the database by sentence ID - the model never supplies quote text.
 */
export function EvidenceSentences({ sentences, evidenceIds }: { sentences: SentenceRow[]; evidenceIds: string[] }) {
  const ev = new Set(evidenceIds);
  return (
    <ol className="space-y-1">
      {sentences.map((s) => {
        const hit = ev.has(s.id);
        return (
          <li key={s.id} className={`flex gap-2.5 rounded-md px-2.5 py-1.5 text-sm leading-relaxed ${hit ? "bg-mark/10 text-fg shadow-[inset_2px_0_0_var(--color-mark)]" : "text-muted"}`}>
            <span className={`tabular mt-[3px] shrink-0 font-mono text-[10px] ${hit ? "text-mark" : "text-faint"}`}>{s.id}</span>
            <span>
              {s.text}
              {hit && <span className="sr-only"> (evidence)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
