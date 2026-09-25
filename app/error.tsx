"use client";

/** Generic error boundary: never shows stack traces or database messages to users. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto mt-24 max-w-md px-4 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">Please try again. If the problem persists, check the server configuration.</p>
      <button onClick={reset} className="mt-4 rounded bg-indigo-700 px-3 py-1 text-sm text-white">
        Try again
      </button>
    </main>
  );
}
