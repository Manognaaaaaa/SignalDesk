import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { FOOTER_TEXT } from "@/config/banned-words";
import { NavLink } from "@/components/NavLink";
import { SignOutButton } from "@/components/SignOutButton";
import { btnPrimary } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import "./globals.css";

// next/font downloads the fonts at build time and serves them from this app: no third-party request at runtime.
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SignalDesk: market news, with receipts", template: "%s · SignalDesk" },
  description: "What moved your assets today, and why. Central-bank and market headlines scored per asset, every claim linked to the sentences it came from.",
  openGraph: {
    title: "SignalDesk: market news, with receipts",
    description: "What moved your assets today, and why, in 60 seconds. Every claim links to its source sentences.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#0b0d10", colorScheme: "dark" };

/** Root layout: header with navigation, and the not-advice footer on every page. No third-party scripts. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-dvh flex-col overflow-x-clip">
        <a href="#main" className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
            <Link href={user ? "/today" : "/"} className="flex items-center gap-2 font-semibold tracking-tight transition hover:opacity-80">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 text-accent" aria-hidden="true">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5 9.5h3l2-6 3 9 2-5h3" />
                </svg>
              </span>
              SignalDesk
            </Link>
            <nav className="flex items-center gap-1 text-sm" aria-label="Main">
              {user && <NavLink href="/today">Today</NavLink>}
              {user && <NavLink href="/watchlist">Watchlist</NavLink>}
              <NavLink href="/how-it-works">How it works</NavLink>
            </nav>
            <div className="ml-auto">
              {user ? (
                <SignOutButton />
              ) : (
                <Link href="/login" className={`${btnPrimary} px-3 py-1.5`}>
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
        <footer className="border-t border-line/70">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-faint sm:px-6">
            <span>{FOOTER_TEXT}</span>
            <Link href="/how-it-works" className="transition hover:text-muted">
              Method and limitations
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
