"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      router.push("/onboarding");
      return;
    }

    setNotice(
      "Account created. Check your email to confirm before logging in.",
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
            Create your account
          </h1>
          <p className="text-sm text-on-surface-variant">
            Real Supabase Auth — this creates a live user.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-[var(--radius-control)] bg-primary py-3 text-sm font-semibold text-on-primary disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Sign up"}
          </button>
        </form>

        {error && <p className="text-sm text-fat">{error}</p>}
        {notice && <p className="text-sm text-primary">{notice}</p>}

        <p className="text-sm text-on-surface-variant">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-primary">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
