import { timeAgo } from "@/lib/format";
import type { LastSignal } from "@/lib/ui-types";
import { StanceBadge } from "./StanceBadge";

/** Quiet-day state for a mood: what the last scored signal said, instead of a dead end. */
export function LastSignalNote({ last }: { last: LastSignal | null }) {
  if (!last) return <span>No scored news in the last 7 days</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>No scored news today. Last signal {timeAgo(last.at)}</span>
      <StanceBadge stance={last.stance} />
    </span>
  );
}
