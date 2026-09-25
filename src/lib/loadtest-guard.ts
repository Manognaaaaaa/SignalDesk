/**
 * Load-test target guard: the load test only runs against hosts listed in LOADTEST_ALLOWED_HOSTS,
 * so the script can never be pointed at someone else's site (which would be a DoS, not a test).
 * Exact hostname match only - no suffix matching, no wildcards.
 */
export function isLoadtestTargetAllowed(target: string, allowedHostsCsv: string | undefined): boolean {
  const allowed = (allowedHostsCsv ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  return allowed.includes(url.hostname.toLowerCase());
}
