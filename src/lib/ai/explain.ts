import "server-only";
import { z } from "zod";
import { DETECTION_CONFIG, type RuleCode } from "@/config/detection";
import { callJson, type LlmDeps } from "./llm";
import { ungroundedNumbers } from "./number-check";
import { buildSystemPrompt, buildUserPrompt, type LinkContext } from "./prompts";
import { LIKELY_CAUSES, RECOMMENDED_ACTIONS, templateExplanation, type Explanation } from "./templates";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The ONLY shape the model may return. Enums are whitelisted; there is no severity/status field. */
export const explanationSchema = z
  .object({
    summary: z.string().min(1).max(160).refine((s) => words(s) < 20, "summary must be under 20 words"),
    likely_cause: z.enum(LIKELY_CAUSES),
    recommended_action: z.enum(RECOMMENDED_ACTIONS),
    explanation: z.string().min(1).max(600).refine((s) => words(s) < 80, "explanation must be under 80 words"),
  })
  .strict();

export type ExplainInput = {
  alert_id: string | null;
  rule_code: RuleCode;
  severity: string;
  evidence: Record<string, unknown>;
  link: LinkContext;
};

/** Columns written back to the alert row. Deliberately excludes severity and status. */
export type ExplainOutput = {
  ai_status: "done" | "template" | "failed";
  ai_summary: string;
  ai_likely_cause: Explanation["likely_cause"];
  ai_recommended_action: Explanation["recommended_action"];
  ai_explanation: string;
  llm_calls: number;
};

/**
 * Numbers the model may cite besides evidence: the rule's own window length (minutes and hours)
 * and the 7-day / 24-hour baseline periods from the rule definitions.
 */
function contextNumbers(rule: RuleCode): number[] {
  const w = DETECTION_CONFIG[rule].windowMinutes;
  return [w, w / 60, 7, 24];
}

function fromTemplate(input: ExplainInput, status: "template" | "failed", calls: number): ExplainOutput {
  const t = templateExplanation(input.rule_code, input.evidence);
  return {
    ai_status: status,
    ai_summary: t.summary,
    ai_likely_cause: t.likely_cause,
    ai_recommended_action: t.recommended_action,
    ai_explanation: t.explanation,
    llm_calls: calls,
  };
}

/**
 * Explains one alert. ONE model call per alert (plus at most one schema retry).
 * The model can only fill text and pick enums; its output is number-checked against the
 * evidence and replaced by a deterministic template if anything is off. Severity is never read
 * from the model.
 */
export async function explainAlert(input: ExplainInput, deps?: LlmDeps): Promise<ExplainOutput> {
  try {
    const system = buildSystemPrompt();
    const user = buildUserPrompt(
      { rule_code: input.rule_code, severity: input.severity, evidence: input.evidence },
      input.link,
    );
    const res = await callJson("explain", system, user, explanationSchema, {
      maxTokens: 400,
      alertId: input.alert_id,
      deps,
    });
    if (!res.ok) {
      // no key / budget cap -> template by design; schema/http/timeout -> the model failed.
      return fromTemplate(input, res.reason === "no_key" || res.reason === "cap" ? "template" : "failed", res.calls);
    }
    const bad = ungroundedNumbers([res.data.summary, res.data.explanation], input.evidence, contextNumbers(input.rule_code));
    if (bad.length > 0) return fromTemplate(input, "template", res.calls);
    return {
      ai_status: "done",
      ai_summary: res.data.summary,
      ai_likely_cause: res.data.likely_cause,
      ai_recommended_action: res.data.recommended_action,
      ai_explanation: res.data.explanation,
      llm_calls: res.calls,
    };
  } catch {
    console.error("[explain] unexpected failure; using template");
    return fromTemplate(input, "failed", 0);
  }
}
