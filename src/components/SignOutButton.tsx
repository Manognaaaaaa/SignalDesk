"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Signs out (clears the Supabase session cookies) and returns to /login. */
export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await supabaseBrowser().auth.signOut().catch(() => undefined);
        router.push("/login");
        router.refresh();
      }}
      className="rounded border border-slate-300 px-2 py-1 text-xs"
    >
      Sign out
    </button>
  );
}
