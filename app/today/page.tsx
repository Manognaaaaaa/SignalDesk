import Link from "next/link";
import { redirect } from "next/navigation";
import { BeginnerToggle } from "@/components/BeginnerToggle";
import { BriefCard, type BriefPayload } from "@/components/BriefCard";
import { MoodCard } from "@/components/MoodCard";
import { textLink } from "@/components/ui";
import { watchlistHash } from "@/lib/ai/brief";
import { getSessionUser } from "@/lib/auth";
import { getActiveAssets, getBeginnerMode, getMoodSeries, getStoriesForAsset, getWatchlist, hasAnySignals } from "@/lib/data";
import { LastSignalNote } from "@/components/LastSignalNote";
import { serverEnv } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/** Loads today's cached brief for this user/level/watchlist, with its cited articles (RLS: own briefs only). */
async function cachedBrief(level: "standard" | "beginner", assetIds: string[]): Promise<BriefPayload | null> {
  const db = await supabaseServer();
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await db.from("briefs").select("bullets, source").eq("day", day).eq("level", level).eq("watchlist_hash", watchlistHash(assetIds)).maybeSingle();
  if (!data) return null;
  const bullets = data.bullets as BriefPayload["bullets"];
  const ids = [...new Set(bullets.flatMap((b) => b.article_ids))];
  const { data: arts } = ids.length ? await db.from("articles").select("id, title, url, published_at, fetched_at, sources(name)").in("id", ids) : { data: [] };
  const articles = (arts ?? []).map((a) => {
    const src = a.sources as { name: string } | { name: string }[] | null;
    return { id: a.id as string, title: a.title as string, url: a.url as string, published_at: (a.published_at ?? a.fetched_at) as string, source: (Array.isArray(src) ? src[0]?.name : src?.name) ?? "Unknown source" };
  });
  return { source: data.source as "ai" | "template", cached: true, bullets, articles };
}

/** The personal Today page: brief with citations, then a mood card per watchlist asset. */
export default async function TodayPage() {
  if (!(await getSessionUser())) redirect("/login");
  const watchlist = await getWatchlist();
  if (watchlist.length === 0) redirect("/onboarding");

  const beginner = await getBeginnerMode();
  const level = beginner ? "beginner" : "standard";
  const ids = watchlist.map((a) => a.id);
  const [series, stories, initial, anySignals, activity] = await Promise.all([
    getMoodSeries(ids),
    Promise.all(watchlist.map((a) => getStoriesForAsset(a.id, 48, 3))),
    cachedBrief(level, ids),
    hasAnySignals(),
    getActiveAssets(watchlist),
  ]);
  const lastById = new Map(activity.map((x) => [x.asset.id, x.last]));
  const aiOnline = Boolean(serverEnv().GROQ_API_KEY);
  const noNews = stories.every((s) => s.length === 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.02em]">Today</h1>
          <p className="tabular mt-1 text-sm text-faint">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} (UTC)</p>
        </div>
        <BeginnerToggle on={beginner} />
      </div>

      <BriefCard key={level} level={level} initial={initial} aiOnline={aiOnline} />

      {noNews && (
        <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">
          No news for your assets yet today. New headlines arrive every two hours.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {watchlist.map((a, i) => (
          <MoodCard key={a.id} asset={a} series={series.get(a.id) ?? []} stories={stories[i]} aiOffline={!aiOnline && !anySignals} empty={<LastSignalNote last={lastById.get(a.id) ?? null} />} />
        ))}
      </div>
      <p className="text-center text-sm">
        <Link href="/watchlist" className={textLink}>
          Edit watchlist
        </Link>
      </p>
    </div>
  );
}
