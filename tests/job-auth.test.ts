import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeJob, bearerMatches, isAdminEmail } from "@/lib/job-auth";

const SECRET = "s".repeat(64);
const req = (auth?: string, method = "POST") => new Request("http://localhost/api/jobs/ingest", { method, headers: auth ? { Authorization: auth } : {} });
const admins = ["admin@example.com"];

describe("job authorization", () => {
  it("accepts the exact bearer and nothing else", async () => {
    expect(await authorizeJob(req(`Bearer ${SECRET}`), SECRET, admins, async () => null)).toBe(true);
    expect(await authorizeJob(req(`Bearer ${SECRET}x`), SECRET, admins, async () => null)).toBe(false);
    expect(await authorizeJob(req("Bearer short"), SECRET, admins, async () => null)).toBe(false);
    expect(await authorizeJob(req(`Basic ${SECRET}`), SECRET, admins, async () => null)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET}`, "")).toBe(false);
  });

  it("missing bearer: only an allowlisted admin session is accepted", async () => {
    expect(await authorizeJob(req(), SECRET, admins, async () => null)).toBe(false);
    expect(await authorizeJob(req(), SECRET, admins, async () => "someone@example.com")).toBe(false);
    expect(await authorizeJob(req(), SECRET, admins, async () => "Admin@Example.com")).toBe(true);
    expect(await authorizeJob(req(), SECRET, admins, async () => Promise.reject(new Error("x")))).toBe(false);
  });

  it("a wrong bearer never falls back to the admin session", async () => {
    expect(await authorizeJob(req("Bearer wrong"), SECRET, admins, async () => "admin@example.com")).toBe(false);
    expect(isAdminEmail(null, admins)).toBe(false);
  });
});

// Route-level: the handler returns 401 / 405 without touching the pipeline.
const runPipeline = vi.fn();
const getSessionUser = vi.fn();
vi.mock("@/lib/jobs/run-pipeline", () => ({ runPipeline: (...a: unknown[]) => runPipeline(...a) }));
vi.mock("@/lib/auth", () => ({ getSessionUser: () => getSessionUser() }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ CRON_SECRET: SECRET, ADMIN_EMAILS: admins, APP_BASE_URL: "http://localhost:3000", MAX_STANCE_CALLS_PER_RUN: 1 }) }));

describe("POST /api/jobs/ingest", () => {
  beforeEach(() => {
    runPipeline.mockReset().mockResolvedValue({ ok: true });
    getSessionUser.mockReset().mockResolvedValue(null);
  });

  it("401 without or with a wrong bearer, and for a non-admin session", async () => {
    const { POST } = await import("../app/api/jobs/ingest/route");
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    getSessionUser.mockResolvedValue({ id: "u1", email: "user@example.com" });
    expect((await POST(req())).status).toBe(401);
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("200 with the bearer or an admin session; GET is 405", async () => {
    const { POST, GET } = await import("../app/api/jobs/ingest/route");
    expect((await POST(req(`Bearer ${SECRET}`))).status).toBe(200);
    getSessionUser.mockResolvedValue({ id: "u2", email: "admin@example.com" });
    expect((await POST(req())).status).toBe(200);
    expect(GET().status).toBe(405);
  });
});
