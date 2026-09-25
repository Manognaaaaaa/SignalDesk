import { isbot } from "isbot";
import { UAParser } from "ua-parser-js";

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot" | "unknown";
export type UaInfo = { ua_family: string; device_type: DeviceType; is_bot: boolean };

/** Script/automation clients that isbot may not list but that no real visitor uses. */
const AUTOMATION = /(curl|wget|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww|httpclient|axios|node-fetch|undici|headless|phantomjs|puppeteer|playwright|selenium)/i;

/**
 * Classifies a user agent into a coarse family, device type and bot flag.
 * Privacy: only these derived values are stored - never the full UA string.
 * An empty or missing UA is treated as a bot (real browsers always send one).
 */
export function classifyUserAgent(ua: string | null | undefined): UaInfo {
  const s = (ua ?? "").slice(0, 512);
  if (s.trim() === "") return { ua_family: "empty", device_type: "bot", is_bot: true };
  const auto = AUTOMATION.exec(s);
  if (auto || isbot(s)) {
    const family = auto ? auto[1]!.toLowerCase() : "bot";
    return { ua_family: family.slice(0, 40), device_type: "bot", is_bot: true };
  }
  const r = new UAParser(s).getResult();
  const family = (r.browser.name ?? "other").slice(0, 40);
  const t = r.device.type;
  const device_type: DeviceType = t === "mobile" ? "mobile" : t === "tablet" ? "tablet" : t === undefined ? "desktop" : "unknown";
  return { ua_family: family, device_type, is_bot: false };
}
