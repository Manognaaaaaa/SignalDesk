import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";

/**
 * SSRF-safe HTTP GET for feed URLs.
 *  - https only, no credentials in the URL, default port only;
 *  - the hostname is resolved HERE and every address must be public (no private, loopback,
 *    link-local/metadata, CGNAT, multicast or reserved ranges); the TCP connection is then pinned
 *    to the checked address, so DNS rebinding between check and connect is impossible;
 *  - at most 3 redirects, each re-validated exactly like the first URL;
 *  - 10 s overall timeout and a 2 MB response cap.
 */

export type SafeFetchErrorCode = "bad_url" | "blocked_ip" | "dns" | "too_many_redirects" | "too_large" | "timeout" | "network";

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export type Resolved = { address: string; family: 4 | 6 };
export type HopResponse = { status: number; headers: Record<string, string>; body: Buffer };
export type Transport = (url: URL, addr: Resolved, opts: { headers: Record<string, string>; maxBytes: number; signal: AbortSignal }) => Promise<HopResponse>;
export type SafeFetchDeps = { resolve: (host: string) => Promise<Resolved[]>; transport: Transport };
export type SafeFetchResult = { status: number; headers: Record<string, string>; body: string; finalUrl: string };

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

const v4ToInt = (ip: string) => ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;

function v4Blocked(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Expands an IPv6 address to 8 hextets (numbers). */
function v6Hextets(ip: string): number[] {
  let s = ip.toLowerCase().split("%")[0]!;
  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1) -> two hextets.
  const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const n = v4ToInt(m[1]!);
    s = s.slice(0, -m[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.includes("::") ? s.split("::") : [s, undefined];
  const h = head ? head.split(":").filter(Boolean) : [];
  const t = tail !== undefined && tail ? tail.split(":").filter(Boolean) : [];
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x, 16));
}

/** True only for globally routable unicast addresses. Anything unparseable counts as NOT public. */
export function isPublicIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return !v4Blocked(ip);
  if (kind !== 6) return false;
  const h = v6Hextets(ip);
  if (h.length !== 8 || h.some((x) => Number.isNaN(x))) return false;
  if (h.every((x) => x === 0)) return false; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return false; // ::1
  // IPv4-mapped / translated forms: judge the embedded IPv4.
  const isMapped = h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff;
  const isNat64 = h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0);
  if (isMapped || isNat64) return !v4Blocked(`${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`);
  const first = h[0]!;
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local (incl. fd00:ec2::254 metadata)
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && h[1] === 0x0db8) return false; // documentation
  return true;
}

/** Validates scheme, credentials and port. Throws bad_url. */
export function checkUrl(raw: string | URL): URL {
  let u: URL;
  try {
    u = new URL(raw.toString());
  } catch {
    throw new SafeFetchError("bad_url", "invalid URL");
  }
  if (u.protocol !== "https:") throw new SafeFetchError("bad_url", "only https is allowed");
  if (u.username || u.password) throw new SafeFetchError("bad_url", "credentials in URL are not allowed");
  if (u.port && u.port !== "443") throw new SafeFetchError("bad_url", "non-default port is not allowed");
  return u;
}

/** Resolves the host and requires EVERY address to be public; returns the one to connect to. */
async function resolvePublic(u: URL, resolve: SafeFetchDeps["resolve"]): Promise<Resolved> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addrs: Resolved[];
  if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) as 4 | 6 }];
  else {
    try {
      addrs = await resolve(host);
    } catch {
      throw new SafeFetchError("dns", "DNS lookup failed");
    }
  }
  if (addrs.length === 0) throw new SafeFetchError("dns", "no addresses");
  if (addrs.some((a) => !isPublicIp(a.address))) throw new SafeFetchError("blocked_ip", "destination resolves to a non-public address");
  return addrs[0]!;
}

/** Real transport: node:https with the socket pinned to the pre-validated address. */
const httpsTransport: Transport = (url, addr, opts) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: opts.headers,
        signal: opts.signal,
        lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          o && o.all ? cb(null, [{ address: addr.address, family: addr.family }]) : cb(null, addr.address, addr.family)) as never,
      },
      (res) => {
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          reject(new SafeFetchError("too_large", "response too large"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            reject(new SafeFetchError("too_large", "response too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers[k] = v;
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
        });
        res.on("error", (e) => reject(e));
      },
    );
    req.on("error", (e) => reject(e));
    req.end();
  });

export const defaultDeps: SafeFetchDeps = {
  resolve: async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family as 4 | 6 })),
  transport: httpsTransport,
};

/** GET `url` safely. Throws SafeFetchError for policy violations; HTTP error statuses are returned, not thrown. */
export async function safeFetch(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {},
  deps: SafeFetchDeps = defaultDeps,
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new SafeFetchError("timeout", "request timed out"));
    }, timeoutMs);
  });

  const run = async (): Promise<SafeFetchResult> => {
    let current = checkUrl(url);
    for (let hop = 0; ; hop++) {
      const addr = await resolvePublic(current, deps.resolve);
      let res: HopResponse;
      try {
        res = await deps.transport(current, addr, {
          headers: { "Accept-Encoding": "identity", ...(opts.headers ?? {}) },
          maxBytes,
          signal: ctrl.signal,
        });
      } catch (e) {
        if (e instanceof SafeFetchError) throw e;
        throw new SafeFetchError(ctrl.signal.aborted ? "timeout" : "network", "network error");
      }
      if (res.body.length > maxBytes) throw new SafeFetchError("too_large", "response too large");
      const location = res.headers["location"];
      if ([301, 302, 303, 307, 308].includes(res.status) && location) {
        if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects", "too many redirects");
        current = checkUrl(new URL(location, current));
        continue;
      }
      return { status: res.status, headers: res.headers, body: res.body.toString("utf8"), finalUrl: current.toString() };
    }
  };

  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
