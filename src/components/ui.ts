/**
 * Shared class recipes so every button, panel and label looks and behaves the same.
 * Colours come from the tokens in app/globals.css.
 */

const press = "transition duration-200 active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

export const btnPrimary = `inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-strong ${press}`;

export const btnSecondary = `inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-fg hover:border-faint hover:bg-raised ${press}`;

export const btnQuiet = `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:bg-raised hover:text-fg ${press}`;

export const textLink = "text-muted underline decoration-line-strong underline-offset-4 transition hover:text-fg hover:decoration-fg";

/** A surface. Tone and spacing do the separating; the hairline border only adds edge definition. */
export const panel = "rounded-xl border border-line/70 bg-surface";

/** Small section label: sentence case, muted, slightly tracked. */
export const label = "text-xs font-medium tracking-wide text-faint";

export const field =
  "mt-1 w-full rounded-lg border border-line-strong bg-bg px-3 py-2 text-sm text-fg placeholder:text-faint transition focus:border-accent focus:outline-none";
