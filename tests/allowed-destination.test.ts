import { describe, expect, it } from "vitest";
import { isAllowedDestination } from "@/lib/redirect/allowed-destination";

const ALLOWED = ["example.com", "partner.example.org"];

describe("isAllowedDestination (open-redirect protection)", () => {
  it.each([
    "https://example.com",
    "https://example.com/landing?x=1",
    "https://www.example.com/path",
    "https://a.b.example.com/",
    "https://partner.example.org/promo",
    "https://EXAMPLE.com/",
  ])("accepts %s", (url) => expect(isAllowedDestination(url, ALLOWED)).toBe(true));

  it.each([
    ["http scheme", "http://example.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["protocol-relative", "//evil.com"],
    ["userinfo trick", "https://example.com@evil.com"],
    ["userinfo with password", "https://user:pass@example.com/"],
    ["lookalike prefix", "https://evil-example.com"],
    ["suffix attack", "https://example.com.evil.com"],
    ["parent of allowed subdomain", "https://example.org"],
    ["ipv4 literal", "https://127.0.0.1/"],
    ["ipv4 hex form", "https://0x7f.1/"],
    ["ipv6 literal", "https://[::1]/"],
    ["explicit port", "https://example.com:8443/"],
    ["malformed", "https://"],
    ["garbage", "not a url"],
    ["backslash trick", "https://evil.com\\@example.com"],
    ["leading whitespace", " https://example.com"],
    ["control char", "https://exa\tmple.com"],
    ["empty", ""],
  ])("rejects %s", (_name, url) => expect(isAllowedDestination(url, ALLOWED)).toBe(false));

  it("rejects everything when the allowlist is empty", () => {
    expect(isAllowedDestination("https://example.com", [])).toBe(false);
  });
});
