"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { btnQuiet } from "./ui";

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
      className={btnQuiet}
    >
      Sign out
    </button>
  );
}
