"use client";
import { btnPrimary } from "@/components/ui";

/** Generic error boundary: never shows stack traces or database messages. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <p className="tabular font-mono text-xs text-down">error</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">The page could not load. Please try again in a moment.</p>
      <button onClick={reset} className={`${btnPrimary} mt-6`}>
        Try again
      </button>
    </div>
  );
}
