import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkSchema, guardedAdminAction } from "@/lib/admin-actions";
import { SlidingWindowLimiter } from "@/lib/rate-limit";

// --- Mocks for the simulate route (no Supabase, no network) ---------------------------------
const requireAdmin = vi.fn();
const runSimulation = vi.fn();
const runDetection = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: () => requireAdmin() }));
vi.mock("@/lib/simulate/live", async (orig) => ({ ...(await orig<typeof import("@/lib/simulate/live")>()), runSimulation: (...a: unknown[]) => runSimulation(...a) }));
vi.mock("@/lib/detection/run-detection", () => ({ runDetection: (...a: unknown[]) => runDetection(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ APP_BASE_URL: "http://localhost:3000", MAX_EXPLANATIONS_PER_RUN: 1 }) }));

const post = (body: unknown) => new Request("http://localhost/api/admin/simulate", { method: "POST", body: JSON.stringify(body) });

describe("admin server actions", () => {
  it("never run the mutation for a non-admin", async () => {
    const run = vi.fn(async () => ({ ok: true as const }));
    expect(await guardedAdminAction(async () => false, run)).toEqual({ ok: false, error: "Not allowed." });
    expect(run).not.toHaveBeenCalled();
  });
  it("fail closed when the session check throws, and hide internal errors", async () => {
    expect((await guardedAdminAction(async () => Promise.reject(new Error("db down")), async () => ({ ok: true }))).ok).toBe(false);
    const r = await guardedAdminAction(async () => true, async () => {
      throw new Error("duplicate key value violates constraint links_pkey");
    });
    expect(r).toEqual({ ok: false, error: "Something went wrong. Please try again." });
  });
});

describe("create-link validation", () => {
  const schema = createLinkSchema(["example.com"]);
  const base = { slug: "ng-new-promo", campaign_name: "New Promo", affiliate_id: "11111111-1111-4111-8111-111111111111", destination_url: "https://go.example.com/x", target_countries: "ng, KE" };
  it("accepts a valid link and normalises countries", () => {
    const r = schema.safeParse(base);
    expect(r.success && r.data.target_countries).toEqual(["NG", "KE"]);
  });
  it("rejects bad slugs, disallowed destinations and unknown countries", () => {
    expect(schema.safeParse({ ...base, slug: "Bad Slug" }).success).toBe(false);
    expect(schema.safeParse({ ...base, destination_url: "https://evil.com" }).success).toBe(false);
    expect(schema.safeParse({ ...base, destination_url: "http://example.com" }).success).toBe(false);
    expect(schema.safeParse({ ...base, target_countries: "UK" }).success).toBe(false);
    expect(schema.safeParse({ ...base, campaign_name: "x" }).success).toBe(false);
    expect(schema.safeParse({ ...base, purpose: "loadtest" }).success).toBe(false);
  });
});

describe("POST /api/admin/simulate", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    runSimulation.mockReset().mockResolvedValue({ scenario: "bot_burst", link_slug: "x", events_written: 1, conversions_written: 0, hot_path_requests: { sent: 0, redirected: 0 } });
    runDetection.mockReset().mockResolvedValue({ inserted: 1 });
  });

  it("rejects affiliates and anonymous callers with 401 before doing anything", async () => {
    const { POST } = await import("../app/api/admin/simulate/route");
    requireAdmin.mockResolvedValue(null);
    expect((await POST(post({ scenario: "bot_burst" }))).status).toBe(401);
    expect(runSimulation).not.toHaveBeenCalled();
  });

  it("validates the body and rate-limits to 3 calls per 10 minutes per admin", async () => {
    const { POST } = await import("../app/api/admin/simulate/route");
    requireAdmin.mockResolvedValue({ userId: "admin-rl", role: "admin" });
    expect((await POST(post({ scenario: "rm -rf" }))).status).toBe(400);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await POST(post({ scenario: "bot_burst" }))).status);
    expect(codes).toEqual([200, 200, 429, 429]); // the invalid call above consumed one slot
    expect(runDetection).toHaveBeenCalled();
  });
});

describe("sliding window limiter", () => {
  it("allows max hits per window and recovers after it", () => {
    const l = new SlidingWindowLimiter(2, 1000);
    expect([l.allow("k", 0), l.allow("k", 10), l.allow("k", 20)]).toEqual([true, true, false]);
    expect(l.allow("other", 20)).toBe(true);
    expect(l.allow("k", 1011)).toBe(true);
  });
});
