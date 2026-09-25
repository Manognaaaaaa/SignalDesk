import { describe, expect, it } from "vitest";
import { isPublicIp, safeFetch, SafeFetchError, type HopResponse, type SafeFetchDeps } from "@/lib/ingest/safe-fetch";

/** Fake DNS + transport: no network. `routes` maps full URL -> response. */
function deps(dns: Record<string, string[]>, routes: Record<string, HopResponse | "hang">): SafeFetchDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (host) => {
      const ips = dns[host];
      if (!ips) throw new Error("ENOTFOUND");
      return ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
    transport: (url, _addr, opts) => {
      calls.push(url.toString());
      const r = routes[url.toString()];
      if (r === "hang") return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      if (!r) return Promise.resolve({ status: 404, headers: {}, body: Buffer.from("") });
      return Promise.resolve(r);
    },
  };
}

const ok = (body = "<rss/>"): HopResponse => ({ status: 200, headers: { etag: '"abc"' }, body: Buffer.from(body) });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof SafeFetchError ? e.code : "other";
  }
};

describe("isPublicIp", () => {
  it("blocks private, loopback, link-local, metadata, CGNAT and reserved ranges", () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    for (const ip of ["::1", "::", "fe80::1", "fd00:ec2::254", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "64:ff9b::a9fe:a9fe", "2001:db8::1", "not-an-ip"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicIp(ip), ip).toBe(true);
  });
});

describe("safeFetch", () => {
  const dns = { "feeds.example.com": ["93.184.216.34"], "evil.example.com": ["10.0.0.5"], "mixed.example.com": ["93.184.216.34", "127.0.0.1"] };

  it("fetches a public https URL", async () => {
    const d = deps(dns, { "https://feeds.example.com/rss": ok("<rss>hi</rss>") });
    const r = await safeFetch("https://feeds.example.com/rss", {}, d);
    expect(r.status).toBe(200);
    expect(r.body).toBe("<rss>hi</rss>");
    expect(r.headers.etag).toBe('"abc"');
  });

  it("refuses http, credentials and odd ports", async () => {
    const d = deps(dns, {});
    expect(await code(safeFetch("http://feeds.example.com/rss", {}, d))).toBe("bad_url");
    expect(await code(safeFetch("https://user:pw@feeds.example.com/rss", {}, d))).toBe("bad_url");
    expect(await code(safeFetch("https://feeds.example.com:8443/rss", {}, d))).toBe("bad_url");
    expect(d.calls).toHaveLength(0);
  });

  it("refuses hosts resolving to private IPs (any address) and IP literals", async () => {
    const d = deps(dns, {});
    expect(await code(safeFetch("https://evil.example.com/rss", {}, d))).toBe("blocked_ip");
    expect(await code(safeFetch("https://mixed.example.com/rss", {}, d))).toBe("blocked_ip");
    expect(await code(safeFetch("https://127.0.0.1/rss", {}, d))).toBe("blocked_ip");
    expect(await code(safeFetch("https://[::1]/rss", {}, d))).toBe("blocked_ip");
    expect(await code(safeFetch("https://169.254.169.254/latest/meta-data", {}, d))).toBe("blocked_ip");
    expect(d.calls).toHaveLength(0);
  });

  it("re-checks every redirect and blocks a redirect to a private IP", async () => {
    const d = deps(dns, {
      "https://feeds.example.com/rss": { status: 302, headers: { location: "https://evil.example.com/internal" }, body: Buffer.from("") },
    });
    expect(await code(safeFetch("https://feeds.example.com/rss", {}, d))).toBe("blocked_ip");
    const d2 = deps(dns, { "https://feeds.example.com/a": { status: 301, headers: { location: "http://feeds.example.com/b" }, body: Buffer.from("") } });
    expect(await code(safeFetch("https://feeds.example.com/a", {}, d2))).toBe("bad_url");
  });

  it("follows at most 3 redirects", async () => {
    const hop = (n: number): HopResponse => ({ status: 302, headers: { location: `/r${n}` }, body: Buffer.from("") });
    const d = deps(dns, { "https://feeds.example.com/r0": hop(1), "https://feeds.example.com/r1": hop(2), "https://feeds.example.com/r2": hop(3), "https://feeds.example.com/r3": ok() });
    expect((await safeFetch("https://feeds.example.com/r0", {}, d)).status).toBe(200);
    const d2 = deps(dns, { ...Object.fromEntries([0, 1, 2, 3].map((i) => [`https://feeds.example.com/r${i}`, hop(i + 1)])) });
    expect(await code(safeFetch("https://feeds.example.com/r0", {}, d2))).toBe("too_many_redirects");
  });

  it("rejects oversized responses", async () => {
    const d = deps(dns, { "https://feeds.example.com/big": ok("x".repeat(2000)) });
    expect(await code(safeFetch("https://feeds.example.com/big", { maxBytes: 1000 }, d))).toBe("too_large");
  });

  it("honours the timeout", async () => {
    const d = deps(dns, { "https://feeds.example.com/slow": "hang" });
    const t0 = Date.now();
    expect(await code(safeFetch("https://feeds.example.com/slow", { timeoutMs: 50 }, d))).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
