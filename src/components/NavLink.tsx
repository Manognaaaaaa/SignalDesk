"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header link that marks the current page (visually and with aria-current). */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative rounded-md px-2 py-1 transition hover:text-fg ${active ? "text-fg after:absolute after:inset-x-2 after:-bottom-[13px] after:h-px after:bg-accent" : "text-muted"}`}
    >
      {children}
    </Link>
  );
}
