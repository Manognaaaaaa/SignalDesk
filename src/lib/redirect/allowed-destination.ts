/**
 * Open-redirect protection. A destination is allowed only if ALL hold:
 *  - it parses with the WHATWG URL parser (the same one browsers use),
 *  - the protocol is exactly "https:" (blocks javascript:, data:, http:, and protocol-relative //),
 *  - there is no username/password (blocks https://allowed.com@evil.com),
 *  - there is no explicit port,
 *  - the hostname is not an IP literal,
 *  - the hostname equals an allowlisted domain or is a subdomain of one (label boundary, so
 *    evil-allowed.com and allowed.com.evil.com are rejected).
 * Called when links are created AND again on every redirect (defence in depth).
 */
export function isAllowedDestination(raw: string, allowedDomains: readonly string[]): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  // Reject whitespace padding, control characters and backslashes (parsers normalise "\" to "/").
  if (raw !== raw.trim() || /[\u0000-\u001f\u007f\\]/.test(raw)) return false;
  if (!raw.toLowerCase().startsWith("https://")) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return false;
  // IPv6 literals are bracketed; IPv4 (incl. forms the parser normalised, e.g. 0x7f.1) are dotted digits.
  if (host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;

  return allowedDomains.some((d) => {
    const domain = d.toLowerCase().trim().replace(/\.$/, "");
    return domain.length > 0 && (host === domain || host.endsWith(`.${domain}`));
  });
}
