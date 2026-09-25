"use client";

/** Small citation chip; tapping it opens the Evidence drawer for that article. */
export function SourceChip({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:border-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      title="Show the evidence"
    >
      <span aria-hidden="true">↗</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
