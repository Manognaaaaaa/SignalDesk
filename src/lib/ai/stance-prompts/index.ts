import { createHash } from "node:crypto";
import type { AssetType } from "@/config/assets-seed";
import type { StancePrompt } from "./types";
import { stanceV1 } from "./v1";

/**
 * Registry of stance prompt versions. STANCE_PROMPT_VERSION picks the active one (default v1);
 * its version string is written to asset_signals.prompt_version and llm_calls.prompt_version,
 * and eval reports record it together with templateHash() so a result always names exact text.
 */

export type { StancePrompt } from "./types";

export const STANCE_PROMPTS: Record<string, StancePrompt> = { v1: stanceV1 };
export const DEFAULT_STANCE_PROMPT_VERSION = "v1";

const ASSET_TYPES: AssetType[] = ["currency_pair", "commodity", "index", "stock", "crypto", "central_bank"];

export function getStancePrompt(version: string = DEFAULT_STANCE_PROMPT_VERSION): StancePrompt {
  const p = STANCE_PROMPTS[version];
  if (!p) throw new Error(`Unknown stance prompt version "${version}". Known: ${Object.keys(STANCE_PROMPTS).join(", ")}`);
  return p;
}

/** Version from STANCE_PROMPT_VERSION (unset or blank -> default). Throws on an unknown version. */
export function activeStancePrompt(): StancePrompt {
  return getStancePrompt(process.env.STANCE_PROMPT_VERSION?.trim() || DEFAULT_STANCE_PROMPT_VERSION);
}

/** sha256 (first 12 hex chars) of the prompt rendered for every asset type plus a fixed user sample. */
export function templateHash(p: StancePrompt): string {
  const sample = p.user({ name: "SAMPLE", asset_type: "commodity" }, [
    { id: "S1", text: "First sentence." },
    { id: "S2", text: "Second sentence." },
  ]);
  const text = [...ASSET_TYPES.map((t) => p.system(t)), sample].join("\n---\n");
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
