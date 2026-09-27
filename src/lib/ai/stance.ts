import "server-only";
import { z } from "zod";
import type { AssetType } from "@/config/assets-seed";
import type { Sentence } from "@/lib/ingest/sentences";
import { callJson, getDefaultDeps, type LlmDeps } from "./llm";
import { allowedStances, type Stance } from "./prompts";
import { activeStancePrompt, type StancePrompt } from "./stance-prompts";

/**
 * Stance scoring for ONE (article, asset) pair = ONE model call (plus at most one schema retry).
 * The schema is built per call: the stance enum depends on the asset type and evidence_ids must
 * be IDs of the stored sentences. A model that cites a sentence that does not exist fails
 * validation, gets one retry with the error, and is then recorded as 'failed'.
 * Quotes are never taken from the model - the UI looks sentences up by ID.
 */

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function stanceSchema(t: AssetType, validIds: string[]) {
  const valid = new Set(validIds);
  const allowed = allowedStances(t) as [Stance, ...Stance[]];
  return z.object({
    stance: z.enum(allowed),
    strength: z.number().int().min(0).max(3),
    evidence_ids: z
      .array(z.string())
      .min(1)
      .max(3)
      .refine((ids) => ids.every((id) => valid.has(id)), { message: `every evidence_id must be one of: ${validIds.join(", ")}` }),
    why: z
      .string()
      .max(200)
      .refine((s) => words(s) <= 25, "why must be at most 25 words"),
  });
}

export type StanceInput = { asset: { name: string; asset_type: AssetType }; sentences: Sentence[] };

/** Row written to asset_signals. */
export type SignalRow = {
  stance: Stance;
  strength: number;
  evidence_ids: string[];
  why: string;
  status: "ok" | "unclear" | "failed";
  model: string;
  prompt_version: string;
};

/** Either a row to save, or "skipped" (no key / cap / network): the pair is retried on a later run. */
export type StanceOutcome = { kind: "saved"; row: SignalRow; calls: number } | { kind: "skipped"; reason: string; calls: number };

/** `prompt` defaults to the version selected by STANCE_PROMPT_VERSION; its version is recorded on the row and in llm_calls. */
export async function scoreStance(input: StanceInput, deps?: LlmDeps, prompt: StancePrompt = activeStancePrompt()): Promise<StanceOutcome> {
  const d = { ...(deps ?? getDefaultDeps()), promptVersion: prompt.version };
  const ids = input.sentences.map((s) => s.id);
  const res = await callJson("stance", prompt.system(input.asset.asset_type), prompt.user(input.asset, input.sentences), stanceSchema(input.asset.asset_type, ids), {
    maxTokens: 250,
    deps: d,
  });
  const meta = { model: d.model, prompt_version: prompt.version };
  if (res.ok) {
    const evidence = [...new Set(res.data.evidence_ids)];
    return {
      kind: "saved",
      calls: res.calls,
      row: { ...meta, stance: res.data.stance, strength: res.data.strength, evidence_ids: evidence, why: res.data.why.trim(), status: res.data.stance === "unclear" ? "unclear" : "ok" },
    };
  }
  if (res.reason === "schema") {
    // Invalid twice: record the failure so we do not pay for it again every run.
    return { kind: "saved", calls: res.calls, row: { ...meta, stance: "unclear", strength: 0, evidence_ids: [], why: "", status: "failed" } };
  }
  return { kind: "skipped", reason: res.reason, calls: res.calls };
}
