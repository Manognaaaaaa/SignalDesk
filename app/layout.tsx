import type { Metadata } from "next";
import Link from "next/link";
import { FOOTER_TEXT } from "@/config/banned-words";
import { SignOutButton } from "@/components/SignOutButton";
import { getSessionUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "SignalDesk",
  description: "Your watchlist's market news, explained with receipts.",
};

/** Root layout: header with navigation, and the not-advice footer on every page. No third-party scripts or fonts. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
          <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
            <Link href={user ? "/today" : "/"} className="font-semibold tracking-tight">
              Signal<span className="text-emerald-600 dark:text-emerald-400">Desk</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-300">
              {user && <Link href="/today">Today</Link>}
              {user && <Link href="/watchlist">Watchlist</Link>}
              <Link href="/how-it-works">How it works</Link>
            </nav>
            <div className="ml-auto">
              {user ? (
                <SignOutButton />
              ) : (
                <Link href="/login" className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-slate-900">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-slate-200 px-4 py-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">{FOOTER_TEXT}</footer>
      </body>
    </html>
  );
}
