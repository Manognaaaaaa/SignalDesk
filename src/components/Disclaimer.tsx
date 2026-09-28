import { DISCLAIMER } from "@/config/banned-words";

/** The not-advice line shown under every brief and mood summary. */
export function Disclaimer({ className = "" }: { className?: string }) {
  return <p className={`text-xs text-faint ${className}`}>{DISCLAIMER}</p>;
}
