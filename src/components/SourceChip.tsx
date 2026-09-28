"use client";

/** Small citation chip; tapping it opens the Evidence drawer for that article. */
export function SourceChip({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex max-w-[15rem] items-center gap-1.5 truncate rounded-md border border-line-strong bg-raised px-2 py-1 text-[11px] text-muted transition hover:border-mark/60 hover:text-fg active:translate-y-px"
      title="Show the evidence"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-mark/80" />
      <span className="truncate">{label}</span>
    </button>
  );
}
