/**
 * Daily candles from Deriv's public market-data WebSocket (no key, no account).
 * The public endpoint rate-limits ticks_history hard: back-to-back requests fail, ~3 s apart
 * succeed (measured 2026-09-28). So requests go out one at a time on a single socket with a gap,
 * and a RateLimit error gets one longer wait and one retry. Never throws: every symbol returns
 * candles or an error code, so one bad symbol never stops the rest.
 */

export const DERIV_PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";
export const REQUEST_GAP_MS = 3_200;
const RATE_LIMIT_WAIT_MS = 15_000;
const RESPONSE_TIMEOUT_MS = 10_000;

export type Candle = { epoch: number; open: number; high: number; low: number; close: number };
export type CandleResult = { symbol: string; ok: true; candles: Candle[] } | { symbol: string; ok: false; error: string };

/** The subset of the WebSocket API we use, so tests can inject a fake. */
export type SocketLike = {
  send: (data: string) => void;
  close: () => void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
};
export type SocketFactory = (url: string) => SocketLike;

export type DerivDeps = { connect: SocketFactory; sleep: (ms: number) => Promise<void>; url: string; gapMs: number };

export const defaultDerivDeps = (): DerivDeps => ({
  connect: (url) => new WebSocket(url) as unknown as SocketLike,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  url: process.env.DERIV_WS_URL?.trim() || DERIV_PUBLIC_WS,
  gapMs: REQUEST_GAP_MS,
});

/** Validates one raw candle; anything malformed is dropped rather than stored. */
export function toCandle(raw: unknown): Candle | null {
  const r = raw as Record<string, unknown>;
  const n = (k: string) => (typeof r?.[k] === "number" ? (r[k] as number) : typeof r?.[k] === "string" ? Number(r[k]) : NaN);
  const c = { epoch: n("epoch"), open: n("open"), high: n("high"), low: n("low"), close: n("close") };
  return Object.values(c).every(Number.isFinite) && c.close > 0 && c.high >= c.low ? c : null;
}

/** UTC calendar day of a daily candle. */
export const candleDay = (c: Candle) => new Date(c.epoch * 1000).toISOString().slice(0, 10);

export async function fetchDailyCandles(symbols: string[], count: number, deps: DerivDeps = defaultDerivDeps()): Promise<CandleResult[]> {
  if (symbols.length === 0) return [];
  let socket: SocketLike;
  try {
    socket = deps.connect(deps.url);
  } catch {
    return symbols.map((symbol) => ({ symbol, ok: false as const, error: "connect_failed" }));
  }

  // One set of handlers: `settleOpen` resolves the connect wait (extra calls are no-ops) and
  // `pending` receives the reply to the request in flight (null = error, close or bad JSON).
  let pending: ((msg: Record<string, unknown> | null) => void) | null = null;
  let settleOpen: (ok: boolean) => void = () => undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  const opened = new Promise<boolean>((resolve) => {
    settleOpen = resolve;
    openTimer = setTimeout(() => resolve(false), RESPONSE_TIMEOUT_MS);
  });
  socket.onopen = () => {
    clearTimeout(openTimer);
    settleOpen(true);
  };
  socket.onerror = () => {
    settleOpen(false);
    pending?.(null);
  };
  socket.onclose = () => {
    settleOpen(false);
    pending?.(null);
  };
  socket.onmessage = (ev) => {
    let msg: Record<string, unknown> | null = null;
    try {
      msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
    } catch {
      msg = null;
    }
    pending?.(msg);
  };

  if (!(await opened)) {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    return symbols.map((symbol) => ({ symbol, ok: false as const, error: "connect_failed" }));
  }

  const ask = (symbol: string) =>
    new Promise<Record<string, unknown> | null>((resolve) => {
      const t = setTimeout(() => {
        pending = null;
        resolve(null);
      }, RESPONSE_TIMEOUT_MS);
      pending = (msg) => {
        clearTimeout(t);
        pending = null;
        resolve(msg);
      };
      socket.send(JSON.stringify({ ticks_history: symbol, style: "candles", granularity: 86_400, count, end: "latest" }));
    });

  const out: CandleResult[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i]!;
    if (i > 0) await deps.sleep(deps.gapMs);
    let msg = await ask(symbol);
    const code = (m: Record<string, unknown> | null) => ((m?.error as { code?: string } | undefined)?.code ?? null);
    if (code(msg) === "RateLimit") {
      await deps.sleep(RATE_LIMIT_WAIT_MS);
      msg = await ask(symbol);
    }
    if (!msg) out.push({ symbol, ok: false, error: "timeout" });
    else if (code(msg)) out.push({ symbol, ok: false, error: code(msg)!.slice(0, 40) });
    else {
      const candles = (Array.isArray(msg.candles) ? msg.candles : []).map(toCandle).filter((c): c is Candle => c !== null);
      out.push(candles.length ? { symbol, ok: true, candles } : { symbol, ok: false, error: "no_candles" });
    }
  }
  try {
    socket.close();
  } catch {
    /* ignore */
  }
  return out;
}
