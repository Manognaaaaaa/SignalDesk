import { describe, expect, it, vi } from "vitest";
import { handleRedirect, type RedirectDeps } from "@/lib/redirect/handler";
import { handleConversion, type ConversionDeps } from "@/lib/webhook/handler";
import { signPayload } from "@/lib/webhook/hmac";
import type { CachedLink } from "@/lib/redirect/link-cache";

const LINK: CachedLink = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "ng-summer-promo",
  destination_url: "https://example.com/landing?utm_source=aff",
  purpose: "campaign",
};

function deps(over: Partial<RedirectDeps> = {}) {
  const tasks: (() => Promise<void>)[] = [];
  const d: RedirectDeps = {
    allowedDomains: ["example.com"],
    findLink: async (s) => (s === LINK.slug ? LINK : null),
    schedule: (t) => tasks.push(t),
    logClick: vi.fn(async () => undefined),
    ...over,
  };
  return { d, tasks };
}

const req = (headers: Record<string, string> = {}) => new Request("https://app.test/r/x", { headers });

describe("GET /r/[slug] hot path", () => {
  it("valid slug -> 302 with lp_click_id, existing params kept, no-store", async () => {
    const { d, tasks } = deps();
    const res = await handleRedirect(req(), LINK.slug, d);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("https://example.com");
    expect(loc.searchParams.get("utm_source")).toBe("aff");
    expect(loc.searchParams.get("lp_click_id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    // logging is deferred until after the response, not awaited inline
    expect(d.logClick).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
  });

  it.each(["AB", "UPPER-case", "has_underscore", "a".repeat(41), "../etc"])("invalid slug %s -> 404", async (slug) => {
    const { d } = deps();
    expect((await handleRedirect(req(), slug, d)).status).toBe(404);
  });

  it("unknown slug -> 404", async () => {
    const { d } = deps();
    expect((await handleRedirect(req(), "no-such-link", d)).status).toBe(404);
  });

  it("disallowed destination stored in DB -> 404 (defence in depth)", async () => {
    const { d } = deps({ findLink: async () => ({ ...LINK, destination_url: "https://evil.com/phish" }) });
    expect((await handleRedirect(req(), LINK.slug, d)).status).toBe(404);
  });

  it("DB lookup failure -> generic 404, no throw", async () => {
    const { d } = deps({
      findLink: async () => {
        throw new Error("db down");
      },
    });
    expect((await handleRedirect(req(), LINK.slug, d)).status).toBe(404);
  });

  it("a logging failure keeps the 302", async () => {
    const { d } = deps({
      schedule: () => {
        throw new Error("after() unavailable");
      },
    });
    expect((await handleRedirect(req(), LINK.slug, d)).status).toBe(302);
  });

  it("passes the click id used in the URL to the logger", async () => {
    const { d, tasks } = deps();
    const res = await handleRedirect(req({ "x-forwarded-for": "203.0.113.5", "x-vercel-ip-country": "NG" }), LINK.slug, d);
    await tasks[0]!();
    const ctx = vi.mocked(d.logClick).mock.calls[0]![0];
    expect(new URL(res.headers.get("location")!).searchParams.get("lp_click_id")).toBe(ctx.clickId);
    expect(ctx.country).toBe("NG");
  });
});

describe("POST /api/conversion", () => {
  const SECRET = "webhook-secret-0123456789";
  const CLICK = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const seen = new Set<string>();
  const cdeps: ConversionDeps = {
    secret: SECRET,
    findClickLink: async (id) => (id === CLICK ? LINK.id : null),
    insert: async (row) => {
      if (seen.has(row.event_id)) return "duplicate";
      seen.add(row.event_id);
      return "created";
    },
  };
  const signed = (body: string, ts = String(Math.floor(Date.now() / 1000))) =>
    new Request("https://app.test/api/conversion", {
      method: "POST",
      body,
      headers: { "x-linkpulse-timestamp": ts, "x-linkpulse-signature": signPayload(SECRET, ts, body) },
    });
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ event_id: "evt_abcdefgh", click_id: CLICK, type: "signup", occurred_at: new Date().toISOString(), ...over });

  it("201 on first delivery, 200 duplicate on retry", async () => {
    const b = body();
    expect((await handleConversion(signed(b), cdeps)).status).toBe(201);
    const dup = await handleConversion(signed(b), cdeps);
    expect(dup.status).toBe(200);
    expect(await dup.json()).toEqual({ status: "duplicate" });
  });

  it("401 on forged signature", async () => {
    const r = new Request("https://app.test/api/conversion", {
      method: "POST",
      body: body(),
      headers: { "x-linkpulse-timestamp": String(Math.floor(Date.now() / 1000)), "x-linkpulse-signature": "sha256=" + "0".repeat(64) },
    });
    expect((await handleConversion(r, cdeps)).status).toBe(401);
  });

  it("401 on replayed old timestamp", async () => {
    expect((await handleConversion(signed(body(), String(Math.floor(Date.now() / 1000) - 400)), cdeps)).status).toBe(401);
  });

  it("413 on oversized body", async () => {
    expect((await handleConversion(signed(body({ pad: "x".repeat(5000) })), cdeps)).status).toBe(413);
  });

  it("422 on unknown click id", async () => {
    const r = signed(body({ event_id: "evt_unknown1", click_id: "00000000-0000-4000-8000-000000000000" }));
    expect((await handleConversion(r, cdeps)).status).toBe(422);
  });

  it("400 on invalid JSON body even when signed", async () => {
    expect((await handleConversion(signed("{not json"), cdeps)).status).toBe(400);
  });
});
