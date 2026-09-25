import { describe, expect, it } from "vitest";
import { isLoadtestTargetAllowed } from "@/lib/loadtest-guard";

describe("load test host allowlist", () => {
  const allowed = "localhost, my-app.vercel.app";
  it("allows only exact listed hosts", () => {
    expect(isLoadtestTargetAllowed("http://localhost:3000", allowed)).toBe(true);
    expect(isLoadtestTargetAllowed("https://my-app.vercel.app", allowed)).toBe(true);
  });
  it("refuses unknown hosts, lookalikes, subdomains and userinfo tricks", () => {
    expect(isLoadtestTargetAllowed("https://example.com", allowed)).toBe(false);
    expect(isLoadtestTargetAllowed("https://my-app.vercel.app.evil.com", allowed)).toBe(false);
    expect(isLoadtestTargetAllowed("https://evil.my-app.vercel.app", allowed)).toBe(false);
    expect(isLoadtestTargetAllowed("https://my-app.vercel.app@evil.com", allowed)).toBe(false);
    expect(isLoadtestTargetAllowed("ftp://localhost", allowed)).toBe(false);
    expect(isLoadtestTargetAllowed("not a url", allowed)).toBe(false);
  });
  it("refuses everything when the allowlist is empty", () => {
    expect(isLoadtestTargetAllowed("http://localhost:3000", undefined)).toBe(false);
    expect(isLoadtestTargetAllowed("http://localhost:3000", " , ")).toBe(false);
  });
});
