import type { ChatClient, LlmCallRecord, LlmDeps } from "@/lib/ai/llm";

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
