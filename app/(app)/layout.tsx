import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Authenticated shell. Re-checks the session server-side (middleware is only a UX gate). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const nav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/links", label: "Links" },
    ...(user.role === "admin" ? [{ href: "/system", label: "System" }] : []),
    { href: "/evaluation", label: "Evaluation" },
  ];
  return (
    <div>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold">LinkPulse</span>
          <nav className="flex gap-3 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="text-slate-700 hover:text-indigo-700">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span>
              {user.email} · {user.role}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
