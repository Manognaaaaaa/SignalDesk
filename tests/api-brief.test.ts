import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Route: session required, body user_id ignored ------------------------------------------
const getSessionUser = vi.fn();
const generate = vi.fn();
vi.mock("@/lib/auth", () => ({ getSessionUser: () => getSessionUser() }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/lib/ai/brief-store", () => ({ supabaseBriefStore: () => ({}) }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ GROQ_API_KEY: undefined }) }));
vi.mock("@/lib/ai/brief", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/brief")>()), generateBrief: (...a: unknown[]) => generate(...a) }));

const post = (body: unknown) => new Request("http://localhost/api/brief", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/brief", () => {
  beforeEach(() => {
    getSessionUser.mockReset();
    generate.mockReset().mockResolvedValue({ ok: true, cached: false, source: "template", bullets: [], articles: [], disclaimer: "d", day: "x" });
  });

  it("requires a session", async () => {
    const { POST } = await import("../app/api/brief/route");
    getSessionUser.mockResolvedValue(null);
    expect((await POST(post({ level: "standard" }))).status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses the session user and ignores user_id in the body", async () => {
    const { POST } = await import("../app/api/brief/route");
    getSessionUser.mockResolvedValue({ id: "session-user", email: "a@b.c" });
    const res = await POST(post({ level: "beginner", user_id: "someone-else" }));
    expect(res.status).toBe(200);
    expect(generate.mock.calls[0]![1]).toBe("session-user");
    expect(generate.mock.calls[0]![2]).toBe("beginner");
    expect((await POST(post({ level: "expert" }))).status).toBe(400);
  });

  it("passes through the rate limit as 429", async () => {
    const { POST } = await import("../app/api/brief/route");
    getSessionUser.mockResolvedValue({ id: "u", email: null });
    generate.mockResolvedValue({ ok: false, status: 429, error: "Daily brief limit reached. Try again tomorrow." });
    expect((await POST(post({ level: "standard" }))).status).toBe(429);
  });
});
