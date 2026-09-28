"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { friendlyAuthMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabaseClient";
import { AuthBrandMark } from "@/components/AuthBrandMark";
import { PasswordField } from "@/components/PasswordField";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(friendlyAuthMessage(signInError, "login"));
      return;
    }

    router.push("/today");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <AuthBrandMark />
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              Log in to keep your streak going.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="login-email" className="text-xs font-medium text-on-surface-variant">
              Email
            </label>
            <input
              id="login-email"
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
            autoComplete="current-password"
          />
          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full rounded-[var(--radius-control)] bg-primary py-3 text-sm font-semibold text-on-primary disabled:opacity-60"
          >
            {loading ? "Logging in…" : "Log in"}
          </button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-fat">
            {error}
          </p>
        )}

        <p className="text-center text-sm text-on-surface-variant">
          No account yet?{" "}
          <Link href="/signup" className="font-semibold text-primary">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
