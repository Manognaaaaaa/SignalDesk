import { describe, expect, it } from "vitest";
import { classifyUserAgent } from "@/lib/redirect/ua";
import { clientIp, hashIp, referrerDomain } from "@/lib/redirect/ip-hash";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

describe("user agent classification", () => {
  it("classifies real browsers as humans with a device type", () => {
    expect(classifyUserAgent(CHROME)).toMatchObject({ is_bot: false, device_type: "desktop", ua_family: "Chrome" });
    expect(classifyUserAgent(IPHONE)).toMatchObject({ is_bot: false, device_type: "mobile" });
  });

  it.each([
    ["empty", ""],
    ["missing", null],
    ["curl", "curl/8.4.0"],
    ["python-requests", "python-requests/2.31.0"],
    ["Go-http-client", "Go-http-client/1.1"],
    ["headless chrome", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0 Safari/537.36"],
    ["googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ])("flags %s as a bot", (_n, ua) => {
    expect(classifyUserAgent(ua)).toMatchObject({ is_bot: true, device_type: "bot" });
  });

  it("never returns the full UA string", () => {
    const info = classifyUserAgent(CHROME);
    expect(JSON.stringify(info)).not.toContain("Windows NT");
  });
});

describe("ip hashing", () => {
  const salt = "salt-0123456789abcdef";
  const day1 = new Date("2026-09-01T10:00:00Z");
  const day1Later = new Date("2026-09-01T23:59:00Z");
  const day2 = new Date("2026-09-02T00:01:00Z");

  it("is stable within a UTC day and rotates the next day", () => {
    expect(hashIp("203.0.113.9", salt, day1)).toBe(hashIp("203.0.113.9", salt, day1Later));
    expect(hashIp("203.0.113.9", salt, day1)).not.toBe(hashIp("203.0.113.9", salt, day2));
  });

  it("never contains the raw IP and depends on the salt", () => {
    const h = hashIp("203.0.113.9", salt, day1);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("203.0.113.9");
    expect(hashIp("203.0.113.9", "other-salt-0123456789", day1)).not.toBe(h);
  });

  it("takes the first x-forwarded-for entry", () => {
    expect(clientIp("198.51.100.1, 10.0.0.1")).toBe("198.51.100.1");
    expect(clientIp(null)).toBe("unknown");
  });

  it("reduces referrers to a hostname", () => {
    expect(referrerDomain("https://News.Example.com/a/b?c=d")).toBe("news.example.com");
    expect(referrerDomain("javascript:alert(1)")).toBeNull();
    expect(referrerDomain("nonsense")).toBeNull();
    expect(referrerDomain(`https://${"a".repeat(150)}.com/`)?.length).toBe(100);
  });
});
