/**
 * Stance label with a consistent colour AND a text label + symbol (never colour alone).
 * Markets: bullish = up (green), bearish = down (red). Central banks: hawkish / dovish get their
 * own warm / cool hues, so tighter policy never reads as "good" or looser as "bad".
 * Neutral is grey; unclear is a dashed outline.
 */
const STYLE: Record<string, { cls: string; sym: string }> = {
  bullish: { cls: "border-up/30 bg-up/10 text-up", sym: "▲" },
  bearish: { cls: "border-down/30 bg-down/10 text-down", sym: "▼" },
  hawkish: { cls: "border-hawk/30 bg-hawk/10 text-hawk", sym: "▲" },
  dovish: { cls: "border-dove/30 bg-dove/10 text-dove", sym: "▼" },
  neutral: { cls: "border-line-strong bg-raised text-muted", sym: "●" },
  unclear: { cls: "border-dashed border-line-strong text-faint", sym: "?" },
};

export function StanceBadge({ stance, strength, failed }: { stance: string | null; strength?: number | null; failed?: boolean }) {
  const key = failed || !stance ? "unclear" : stance;
  const s = STYLE[key] ?? STYLE.unclear!;
  const label = failed ? "not scored" : (stance ?? "not scored");
  const showStrength = strength != null && strength > 0 && !failed && stance !== "unclear";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none ${s.cls}`}>
      <span aria-hidden="true" className="text-[9px]">
        {s.sym}
      </span>
      {label}
      {showStrength && (
        <span className="ml-0.5 inline-flex gap-px" title={`strength ${strength} of 3`} aria-label={`strength ${strength} of 3`}>
          {[1, 2, 3].map((i) => (
            <span key={i} className={`h-2 w-[3px] rounded-[1px] ${i <= strength! ? "bg-current" : "bg-current opacity-25"}`} />
          ))}
        </span>
      )}
    </span>
  );
}
