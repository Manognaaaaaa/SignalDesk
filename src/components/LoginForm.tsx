"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { supabaseBrowser } from "@/lib/supabase/browser";

const schema = z.object({ email: z.email().max(200), password: z.string().min(6).max(200) });

/** Email + password sign-in. Errors are generic so the form does not reveal which accounts exist. */
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
    if (!parsed.success) {
      setError("Enter a valid email and password.");
      return;
    }
    setBusy(true);
    const { error: authError } = await supabaseBrowser().auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (authError) {
      setError("Sign-in failed. Check your credentials and try again.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <label className="block text-sm">
        Email
        <input name="email" type="email" autoComplete="email" required className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
      </label>
      <label className="block text-sm">
        Password
        <input name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
      </label>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <button disabled={busy} className="w-full rounded bg-indigo-700 px-3 py-2 font-medium text-white disabled:opacity-50">
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
