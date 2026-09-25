import { redirect } from "next/navigation";
import { AssetPicker } from "@/components/AssetPicker";
import { getSessionUser } from "@/lib/auth";
import { getCatalogue, getWatchlist } from "@/lib/data";

export const metadata = { title: "Pick your assets - SignalDesk" };
export const dynamic = "force-dynamic";

/** First-run: pick 3 to 10 assets from the catalogue. */
export default async function OnboardingPage() {
  if (!(await getSessionUser())) redirect("/login");
  const [catalogue, current] = await Promise.all([getCatalogue(), getWatchlist()]);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">What do you follow?</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Pick 3 to 10 assets. You can change them any time.</p>
      <AssetPicker assets={catalogue} initial={current.map((a) => a.slug)} mode="onboarding" min={3} max={10} next="/today" />
    </div>
  );
}
