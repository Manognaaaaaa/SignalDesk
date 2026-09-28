import Link from "next/link";
import { btnPrimary, textLink } from "@/components/ui";

/** Branded 404 with a way back. */
export default function NotFound() {
  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <p className="tabular font-mono text-xs text-faint">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">No signal here</h1>
      <p className="mt-2 text-sm text-muted">This page does not exist, or the asset is not in the catalogue.</p>
      <div className="mt-6 flex items-center justify-center gap-5">
        <Link href="/" className={btnPrimary}>
          Back to SignalDesk
        </Link>
        <Link href="/how-it-works" className={`text-sm ${textLink}`}>
          How it works
        </Link>
      </div>
    </div>
  );
}
