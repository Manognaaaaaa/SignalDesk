"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { btnPrimary, field } from "./ui";

const schema = z.object({ email: z.email().max(200), password: z.string().min(8, "Use at least 8 characters").max(200) });

/**
 * Email + password sign in / sign up with Supabase Auth. Errors are generic so the form never
 * reveals which emails have accounts. If email confirmation is on, sign-up asks the user to check
 * their inbox; the link lands on /auth/callback.
 */
export function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const f = new FormData(e.currentTarget);
    const parsed = schema.safeParse({ email: f.get("email"), password: f.get("password") });
    if (!parsed.success) return setMsg({ kind: "error", text: parsed.error.issues[0]?.message ?? "Enter a valid email and password." });
    setBusy(true);
    const sb = supabaseBrowser();
    if (mode === "signin") {
      const { error } = await sb.auth.signInWithPassword(parsed.data);
      setBusy(false);
      if (error) return setMsg({ kind: "error", text: "Sign-in failed. Check your email and password." });
      router.push("/today");
      router.refresh();
      return;
    }
    const { data, error } = await sb.auth.signUp({ ...parsed.data, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setBusy(false);
    if (error) return setMsg({ kind: "error", text: "Could not create the account. Try a different email or a stronger password." });
    if (data.session) {
      router.push("/onboarding");
      router.refresh();
    } else setMsg({ kind: "info", text: "Check your inbox and click the confirmation link, then sign in." });
  }

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 rounded-lg border border-line bg-surface p-1 text-sm" role="tablist">
        {(["signin", "signup"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => (setMode(m), setMsg(null))} className={`rounded-md py-1.5 transition ${mode === m ? "bg-raised font-medium text-fg" : "text-muted hover:text-fg"}`}>
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <label className="block text-sm text-muted">
          Email
          <input name="email" type="email" autoComplete="email" required className={field} />
        </label>
        <label className="block text-sm text-muted">
          Password
          <input name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} className={field} />
        </label>
        {msg && (
          <p className={`text-sm ${msg.kind === "error" ? "text-down" : "text-accent"}`} role="alert">
            {msg.text}
          </p>
        )}
        <button disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
