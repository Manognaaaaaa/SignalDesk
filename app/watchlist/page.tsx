import { redirect } from "next/navigation";
import { AssetPicker } from "@/components/AssetPicker";
import { getSessionUser } from "@/lib/auth";
import { getCatalogue, getWatchlist } from "@/lib/data";

export const metadata = { title: "Watchlist - SignalDesk" };
export const dynamic = "force-dynamic";

/** Add or remove assets (1 to 20; the database enforces the upper limit too). */
export default async function WatchlistPage() {
  if (!(await getSessionUser())) redirect("/login");
  const [catalogue, current] = await Promise.all([getCatalogue(), getWatchlist()]);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Your watchlist</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Tick the assets you want on your Today page.</p>
      <AssetPicker assets={catalogue} initial={current.map((a) => a.slug)} mode="watchlist" min={1} max={20} next="/today" />
    </div>
  );
}
