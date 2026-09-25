import Link from "next/link";
import { DEMO_ASSET_SLUGS } from "@/config/assets-seed";
import { Disclaimer } from "@/components/Disclaimer";
import { MoodCard } from "@/components/MoodCard";
import { getCatalogue, getMoodSeries } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Public landing page: one-line pitch, a live mood card for 3 popular assets (public data), sign-up CTA. */
export default async function Home() {
  const catalogue = await getCatalogue();
  const demo = DEMO_ASSET_SLUGS.map((s) => catalogue.find((a) => a.slug === s)).filter((a) => a !== undefined);
  const series = await getMoodSeries(demo.map((a) => a.id));

  return (
    <div>
      <section className="py-10 text-center sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Market news, with receipts</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">What moved your assets today, and why, in 60 seconds.</h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-600 dark:text-slate-300">
          Pick the assets you follow. SignalDesk reads central-bank and market headlines every two hours and shows the mood for each asset. Every
          claim links back to the exact sentences it came from.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/login" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900">
            Sign up to build your watchlist
          </Link>
          <Link href="/how-it-works" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-700">
            How it works
          </Link>
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Live today</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Updated every 2 hours from public feeds</span>
        </div>
        {demo.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700">The catalogue is not set up yet.</p>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            {demo.map((a) => (
              <MoodCard key={a.id} asset={a} series={series.get(a.id) ?? []} />
            ))}
          </div>
        )}
        <Disclaimer className="mt-4 text-center" />
      </section>
    </div>
  );
}
