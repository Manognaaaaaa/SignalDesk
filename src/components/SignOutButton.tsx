"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Clears the Supabase session and returns to the landing page. */
export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await supabaseBrowser().auth.signOut().catch(() => undefined);
        router.push("/");
        router.refresh();
      }}
      className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
    >
      Sign out
    </button>
  );
}
