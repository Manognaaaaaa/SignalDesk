import { DISCLAIMER } from "@/config/banned-words";

/** The not-advice line shown under every brief and mood summary. */
export function Disclaimer({ className = "" }: { className?: string }) {
  return <p className={`text-xs text-slate-500 dark:text-slate-400 ${className}`}>{DISCLAIMER}</p>;
}
