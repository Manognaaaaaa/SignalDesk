import Link from "next/link";
import { CreateLinkForm } from "@/components/CreateLinkForm";
import { LinksTable } from "@/components/LinksTable";
import { getSessionUser } from "@/lib/auth";
import { getAffiliates, getLinkSummaries } from "@/lib/dashboard-data";
import { serverEnv } from "@/lib/env";

export const metadata = { title: "Links - LinkPulse" };

/** Links overview; admins also get the create form. Affiliates see only their own links (RLS). */
export default async function LinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const includeReplay = sp.replay === "1";
  const user = await getSessionUser();
  const isAdmin = user?.role === "admin";
  const env = serverEnv();
  const [links, affiliates] = await Promise.all([getLinkSummaries(includeReplay), isAdmin ? getAffiliates() : Promise.resolve([])]);
  const origin = env.APP_BASE_URL ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Links</h1>
        <div className="ml-auto flex gap-1 text-xs">
          <Link href="/links" className={`rounded px-2 py-1 ${!includeReplay ? "bg-slate-800 text-white" : "border border-slate-300"}`}>
            Campaign links
          </Link>
          <Link href="/links?replay=1" className={`rounded px-2 py-1 ${includeReplay ? "bg-slate-800 text-white" : "border border-slate-300"}`}>
            Include replay
          </Link>
        </div>
      </div>
      {isAdmin && <CreateLinkForm affiliates={affiliates} allowedDomains={env.ALLOWED_DESTINATION_DOMAINS} />}
      <LinksTable links={links} isAdmin={isAdmin} origin={origin} />
    </div>
  );
}
