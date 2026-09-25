import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getSessionUser } from "@/lib/auth";

export const metadata = { title: "Sign in - SignalDesk" };
export const dynamic = "force-dynamic";

/** Sign in or create an account (Supabase Auth, email + password). */
export default async function LoginPage() {
  if (await getSessionUser()) redirect("/today");
  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to SignalDesk</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Your watchlist&apos;s market news, explained with receipts.</p>
      <AuthForm />
    </div>
  );
}
