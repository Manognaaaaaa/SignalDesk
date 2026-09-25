/**
 * Next.js calls register() once when a server instance boots. Validating env here makes a
 * misconfigured deployment fail immediately instead of on the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEnv } = await import("./src/lib/env");
    serverEnv();
  }
}
