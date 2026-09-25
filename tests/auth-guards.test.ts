import { describe, expect, it, vi } from "vitest";
import { authorizeJob } from "@/lib/job-auth";

const SECRET = "cron-secret-0123456789abcdef";
const req = (auth?: string) =>
  new Request("https://app.test/api/jobs/detect", { method: "POST", headers: auth ? { authorization: auth } : {} });

describe("detect job authorization", () => {
  it("accepts the correct bearer", async () => {
    expect(await authorizeJob(req(`Bearer ${SECRET}`), SECRET, async () => false)).toBe(true);
  });

  it("rejects a missing bearer when not an admin", async () => {
    expect(await authorizeJob(req(), SECRET, async () => false)).toBe(false);
  });

  it("rejects a wrong bearer even for an admin session", async () => {
    const isAdmin = vi.fn(async () => true);
    expect(await authorizeJob(req("Bearer wrong"), SECRET, isAdmin)).toBe(false);
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("accepts an admin session without a bearer", async () => {
    expect(await authorizeJob(req(), SECRET, async () => true)).toBe(true);
  });

  it("fails closed when the session check throws", async () => {
    expect(
      await authorizeJob(req(), SECRET, async () => {
        throw new Error("auth down");
      }),
    ).toBe(false);
  });
});
