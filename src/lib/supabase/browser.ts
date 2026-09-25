"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Browser client: anon key only (public by design). All data access is limited by RLS;
 * it is used for login and Realtime subscriptions.
 */
export function supabaseBrowser(): SupabaseClient {
  if (client) return client;
  client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}
