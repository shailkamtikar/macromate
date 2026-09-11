"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, CoachMessage, fetchCoachHistory, sendCoachMessage } from "@/lib/api";
import { useSession } from "@/lib/useSession";

export default function CoachPage() {
  const { session, loading: sessionLoading } = useSession();
  const [messages, setMessages] = useState<CoachMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session) return;
    fetchCoachHistory()
      .then(setMessages)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load history."));
  }, [session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (sessionLoading) return <p className="p-10 text-sm text-on-surface-variant">Loading…</p>;
  if (!session) {
    return (
      <p className="p-10 text-sm text-on-surface-variant">
        <a href="/login" className="font-semibold text-primary">
          Log in
        </a>{" "}
        first.
      </p>
    );
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    const userMessage: CoachMessage = {
      role: "user",
      content: input,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...(prev ?? []), userMessage]);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const reply = await sendCoachMessage(userMessage.content);
      setMessages((prev) => [...(prev ?? []), reply]);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Coach couldn't respond: ${err.message}`
          : "Something went wrong.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <header className="mb-3">
          <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
            Coach
          </h1>
          <p className="text-sm text-on-surface-variant">
            Ask about your macros, BMI, or nutrition — not a substitute for medical advice.
          </p>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto pb-4">
          {messages === null ? (
            <p className="text-sm text-on-surface-variant">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-outline-variant p-4 text-sm text-on-surface-variant">
              Ask something like &quot;How much protein do I have left?&quot;, &quot;How
              many calories are in 200g paneer?&quot;, or &quot;Add 3 eggs to
              breakfast.&quot;
            </p>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-[var(--radius-card)] p-3 text-sm ${
                  m.role === "user"
                    ? "ml-auto bg-primary text-on-primary"
                    : "bg-surface-container-lowest text-on-surface shadow-sm"
                }`}
              >
                <p>{m.content}</p>
                {m.action && (
                  <a
                    href="/today"
                    className="mt-1.5 inline-block text-xs font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    View in Today
                  </a>
                )}
              </div>
            ))
          )}
          {sending && <p className="text-xs text-on-surface-variant">Coach is thinking…</p>}
          <div ref={bottomRef} />
        </div>

        {error && <p className="mb-2 text-sm text-fat">{error}</p>}

        <form onSubmit={handleSend} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the coach…"
            className="input flex-1"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
