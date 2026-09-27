import type { AssetType } from "@/config/assets-seed";
import type { Sentence } from "@/lib/ingest/sentences";

/** One immutable version of the stance (Judge) prompt. */
export type StancePrompt = {
  version: string;
  system: (t: AssetType) => string;
  user: (asset: { name: string; asset_type: AssetType }, sentences: Sentence[]) => string;
};
