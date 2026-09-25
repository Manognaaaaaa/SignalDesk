"use client";

/** Generic error boundary: never shows stack traces or database messages. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto mt-20 max-w-md text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Please try again in a moment.</p>
      <button onClick={reset} className="mt-4 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-slate-900">
        Try again
      </button>
    </div>
  );
}
