import type { SupabaseClient } from "@supabase/supabase-js";
import { MOOD_CONFIG } from "@/config/mood";
import { computeMood, utcDay, type MoodSignal } from "@/lib/mood/compute";

/**
 * Step 6: recompute daily_mood for the last 7 days from stored signals (deterministic).
 * Reads are paginated because PostgREST caps rows per request.
 */

export type MoodStats = { signals_read: number; rows_upserted: number };

type Row = {
  asset_id: string;
  article_id: string;
  stance: string;
  strength: number;
  status: string;
  articles: { source_id: string; story_id: string | null; published_at: string | null; fetched_at: string } | null;
};

export async function runMoodStep(db: SupabaseClient, now: Date = new Date()): Promise<MoodStats> {
  const firstDay = utcDay(new Date(now.getTime() - (MOOD_CONFIG.days - 1) * 86_400_000));
  // Signals are created after their article; read a margin of extra days, filter by article day below.
  const since = new Date(now.getTime() - (MOOD_CONFIG.days + 7) * 86_400_000).toISOString();
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("asset_signals")
      .select("asset_id, article_id, stance, strength, status, articles!inner(source_id, story_id, published_at, fetched_at)")
      .eq("status", "ok")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`signals read failed: ${error.code ?? "unknown"}`);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }

  const signals: MoodSignal[] = rows
    .filter((r) => r.articles)
    .map((r) => ({
      asset_id: r.asset_id,
      article_id: r.article_id,
      source_id: r.articles!.source_id,
      story_id: r.articles!.story_id,
      stance: r.stance,
      strength: r.strength,
      status: r.status,
      at: new Date(r.articles!.published_at ?? r.articles!.fetched_at),
    }));
  const mood = computeMood(signals, now).filter((m) => m.day >= firstDay && m.day <= utcDay(now));
  if (mood.length) {
    const { error } = await db.from("daily_mood").upsert(mood, { onConflict: "asset_id,day" });
    if (error) throw new Error(`mood upsert failed: ${error.code ?? "unknown"}`);
  }
  return { signals_read: rows.length, rows_upserted: mood.length };
}
