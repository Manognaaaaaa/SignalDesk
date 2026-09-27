import { describe, expect, it } from "vitest";
import { STANCE_PROMPTS, activeStancePrompt, getStancePrompt, templateHash } from "@/lib/ai/stance-prompts";

describe("stance prompt versions", () => {
  it("v1 is frozen: changing its wording must create a new version instead", () => {
    // If this fails you edited v1. Revert it, copy it to v2.ts, change v2 and register it in index.ts.
    expect(templateHash(getStancePrompt("v1"))).toBe("3adf9d693f86");
  });

  it("every registered prompt reports the version it is registered under", () => {
    for (const [key, p] of Object.entries(STANCE_PROMPTS)) expect(p.version).toBe(key);
  });

  it("distinct versions have distinct text", () => {
    const hashes = Object.values(STANCE_PROMPTS).map(templateHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("rejects unknown versions and defaults to v1", () => {
    expect(() => getStancePrompt("v999")).toThrow(/Unknown stance prompt version/);
    const saved = process.env.STANCE_PROMPT_VERSION;
    delete process.env.STANCE_PROMPT_VERSION;
    expect(activeStancePrompt().version).toBe("v1");
    if (saved !== undefined) process.env.STANCE_PROMPT_VERSION = saved;
  });
});
