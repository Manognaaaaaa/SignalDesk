/** Plain data shapes passed from server pages to client components (no secrets, no PII). */

export type Kpis = {
  clicks_24h: number;
  unique_visitors_24h: number;
  bot_clicks_24h: number;
  signups_24h: number;
  open_alerts: number;
};

export type SeriesPoint = { hour: string; clicks: number; bot_clicks: number; signups: number };

export type AlertRow = {
  id: string;
  link_id: string;
  link_slug: string;
  campaign_name: string;
  rule_code: string;
  severity: "low" | "medium" | "high";
  window_start: string;
  window_end: string;
  evidence: Record<string, unknown>;
  status: "open" | "acknowledged" | "resolved";
  resolution: string | null;
  ai_status: "pending" | "done" | "template" | "failed";
  ai_summary: string | null;
  ai_likely_cause: string | null;
  ai_recommended_action: string | null;
  ai_explanation: string | null;
  created_at: string;
};

export type LinkSummary = {
  link_id: string;
  slug: string;
  campaign_name: string;
  affiliate_name: string | null;
  purpose: string;
  is_active: boolean;
  destination_url: string;
  target_countries: string[];
  clicks_24h: number;
  signups_24h: number;
  open_alerts: number;
};

export type AffiliateOption = { id: string; name: string };
