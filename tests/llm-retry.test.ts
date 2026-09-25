import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { callJson, clearLlmCache } from "@/lib/ai/llm";
import { fakeClient, fakeDeps } from "./fixtures/helpers";

const schema = z.object({ answer: z.string() }).strict();
const GOOD = JSON.stringify({ answer: "ok" });

describe("Groq wrapper retries", () => {
  beforeEach(() => clearLlmCache());

  it("retries 429 and 500 with exponential backoff + jitter, then succeeds", async () => {
    const { client, requests } = fakeClient([{ status: 429 }, { status: 500 }, GOOD]);
    const { deps, logs, sleeps } = fakeDeps(client, { random: () => 0.5 });
    const res = await callJson("stance", "sys", "user-1", schema, { deps });
    expect(res.ok).toBe(true);
    expect(requests).toHaveLength(3);
    expect(sleeps).toEqual([500 + 125, 1500 + 125]);
    expect(logs.map((l) => l.status)).toEqual(["rate_limited", "failed", "ok"]);
  });

  it("respects Retry-After when longer than the backoff", async () => {
    const { client } = fakeClient([{ status: 429, headers: { "retry-after": "3" } }, GOOD]);
    const { deps, sleeps } = fakeDeps(client);
    await callJson("stance", "sys", "user-ra", schema, { deps });
    expect(sleeps).toEqual([3000]);
  });

  it("gives up after 2 HTTP retries", async () => {
    const { client, requests } = fakeClient([{ status: 503 }, { status: 503 }, { status: 503 }, GOOD]);
    const { deps } = fakeDeps(client);
    const res = await callJson("stance", "sys", "user-2", schema, { deps });
    expect(res).toMatchObject({ ok: false, reason: "http" });
    expect(requests).toHaveLength(3);
  });

  it.each([400, 401, 403])("never retries %i", async (status) => {
    const { client, requests } = fakeClient([{ status }, GOOD]);
    const { deps, sleeps } = fakeDeps(client);
    const res = await callJson("stance", "sys", `user-${status}`, schema, { deps });
    expect(res.ok).toBe(false);
    expect(requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("schema failure -> one retry with the zod error appended -> success", async () => {
    const { client, requests } = fakeClient([JSON.stringify({ wrong: 1 }), GOOD]);
    const { deps, logs } = fakeDeps(client);
    const res = await callJson("stance", "sys", "user-3", schema, { deps });
    expect(res.ok).toBe(true);
    const second = (requests[1]!.messages as { content: string }[])[1]!.content;
    expect(second).toContain("Your previous output failed validation");
    expect(logs.map((l) => l.status)).toEqual(["schema_retry", "ok"]);
  });

  it("two schema failures -> ok:false (caller falls back), no regex guessing", async () => {
    const { client, requests } = fakeClient(['Sure! {"answer": "ok"}', "not json", GOOD]);
    const { deps, logs } = fakeDeps(client);
    const res = await callJson("stance", "sys", "user-4", schema, { deps });
    expect(res).toMatchObject({ ok: false, reason: "schema" });
    expect(requests).toHaveLength(2);
    expect(logs.map((l) => l.status)).toEqual(["schema_retry", "failed"]);
  });

  it("daily cap -> no call at all", async () => {
    const { client, requests } = fakeClient([GOOD]);
    const { deps } = fakeDeps(client, { maxCallsPerDay: 300, countCallsToday: async () => 300 });
    const res = await callJson("stance", "sys", "user-5", schema, { deps });
    expect(res).toMatchObject({ ok: false, reason: "cap" });
    expect(requests).toHaveLength(0);
  });

  it("no client (no API key) -> no_key", async () => {
    const { deps } = fakeDeps(null);
    expect(await callJson("stance", "sys", "user-6", schema, { deps })).toMatchObject({ ok: false, reason: "no_key" });
  });

  it("caches by prompt hash and logs cost without the prompt text", async () => {
    const { client, requests } = fakeClient([GOOD]);
    const { deps, logs } = fakeDeps(client);
    await callJson("stance", "sys", "user-7", schema, { deps });
    const again = await callJson("stance", "sys", "user-7", schema, { deps });
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(requests).toHaveLength(1);
    expect(logs[0]!.est_cost_usd).toBeCloseTo((100 * 0.59 + 50 * 0.79) / 1e6, 10);
    expect(JSON.stringify(logs)).not.toContain("user-7");
  });

  it("sends temperature 0 and json_object response format", async () => {
    const { client, requests } = fakeClient([GOOD]);
    const { deps } = fakeDeps(client);
    await callJson("stance", "sys", "user-8", schema, { deps, maxTokens: 400 });
    expect(requests[0]).toMatchObject({ temperature: 0, max_tokens: 400, response_format: { type: "json_object" } });
  });
});
