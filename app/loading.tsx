/** Loading skeleton shared by all pages, shaped like the cards it replaces. */
export default function Loading() {
  const bar = "animate-pulse rounded-md bg-raised motion-reduce:animate-none";
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className={`h-8 w-44 ${bar}`} />
      <div className="rounded-xl border border-line/70 bg-surface p-6">
        <div className={`h-4 w-1/3 ${bar}`} />
        <div className={`mt-4 h-3 w-5/6 ${bar}`} />
        <div className={`mt-2 h-3 w-2/3 ${bar}`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border border-line/70 bg-surface p-5">
            <div className={`h-4 w-24 ${bar}`} />
            <div className={`mt-6 h-2 w-full ${bar}`} />
            <div className={`mt-6 h-10 w-full ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
