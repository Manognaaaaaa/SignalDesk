import type { LinkWindowStats } from "@/lib/detection/types";
import type { ChatClient, LlmCallRecord, LlmDeps } from "@/lib/ai/llm";

/** A quiet, healthy link: nothing should fire on this. Override fields per test. */
export function makeStats(over: Partial<LinkWindowStats> = {}): LinkWindowStats {
  return {
    link_id: "11111111-1111-4111-8111-111111111111",
    as_of: new Date("2026-09-01T12:07:00Z"),
    target_countries: ["NG"],
    last10m: { clicks: 5, top_ip_clicks: 1 },
    last60m: {
      clicks: 30,
      bot_clicks: 1,
      unknown_bot_clicks: 0,
      off_target_clicks: 2,
      unknown_country_clicks: 0,
      top_off_target_countries: [{ country_code: "US", clicks: 2 }],
    },
    last24h: { clicks: 700, signups: 35 },
    baseline7d_signup_rate: 0.05,
    current_hour_clicks: 30,
    hourly_history: Array.from({ length: 168 }, (_, i) => 25 + (i % 10)),
    ...over,
  };
}

/** Fake Groq client that returns queued responses or throws queued errors, recording each request. */
export function fakeClient(queue: (string | Error | { status: number; headers?: Record<string, string> })[]) {
  const requests: Record<string, unknown>[] = [];
  const client: ChatClient = {
    create: async (body) => {
      requests.push(body);
      const next = queue.shift();
      if (next === undefined) throw new Error("no more fake responses");
      if (next instanceof Error) throw next;
      if (typeof next === "object") throw Object.assign(new Error(`http ${next.status}`), next);
      return { choices: [{ message: { content: next } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };
    },
  };
  return { client, requests };
}

/** LlmDeps wired to a fake client, with recorded audit rows and sleeps (no real waiting). */
export function fakeDeps(client: ChatClient | null, over: Partial<LlmDeps> = {}) {
  const logs: LlmCallRecord[] = [];
  const sleeps: number[] = [];
  const deps: LlmDeps = {
    client,
    model: "test-model",
    promptVersion: "v1",
    priceInPerM: 0.59,
    priceOutPerM: 0.79,
    maxCallsPerDay: 300,
    countCallsToday: async () => 0,
    logCall: async (r) => {
      logs.push(r);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    timeoutMs: 15_000,
    ...over,
  };
  return { deps, logs, sleeps };
}
