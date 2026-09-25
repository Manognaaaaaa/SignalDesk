/** Loading skeleton shared by all pages. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      <div className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  );
}
