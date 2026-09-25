import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LinkPulse",
  description: "Affiliate tracking links with real-time click analytics and deterministic fraud detection.",
};

/** Root layout: no third-party scripts or fonts, so the strict CSP holds. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
          Demo with simulated and replayed traffic. AI explanations assist humans and are not final decisions.
        </footer>
      </body>
    </html>
  );
}
