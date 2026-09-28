"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { friendlyAuthMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabaseClient";
import { AuthBrandMark } from "@/components/AuthBrandMark";
import { PasswordField } from "@/components/PasswordField";

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
      setError(friendlyAuthMessage(signUpError, "signup"));
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
        <div className="flex flex-col items-center gap-4 text-center">
          <AuthBrandMark />
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
              Create your account
            </h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              Start tracking your macros, your way.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="signup-email" className="text-xs font-medium text-on-surface-variant">
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </div>
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={6}
          />
          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full rounded-[var(--radius-control)] bg-primary py-3 text-sm font-semibold text-on-primary disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Sign up"}
          </button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-fat">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-primary">
            {notice}
          </p>
        )}

        <p className="text-center text-sm text-on-surface-variant">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-primary">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
