import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Sign in - LinkPulse" };

/** Public login page (Supabase Auth, email + password). */
export default function LoginPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="text-2xl font-semibold">LinkPulse</h1>
      <p className="mt-1 text-sm text-slate-600">Affiliate link analytics and fraud alerts.</p>
      <LoginForm />
      <p className="mt-6 text-sm text-slate-600">
        Curious how well detection works? See the public{" "}
        <a className="text-indigo-700 underline" href="/evaluation">
          evaluation results
        </a>
        .
      </p>
    </main>
  );
}
