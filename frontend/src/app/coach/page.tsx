"use client";

import { AnimatePresence, m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CoachMessage, fetchCoachHistory, sendCoachMessage } from "@/lib/api";
import { friendlyMessage } from "@/lib/errors";
import { useSession } from "@/lib/useSession";
import { Icon } from "@/components/Icon";
import { LogoMark } from "@/components/Logo";
import { Skeleton } from "@/components/Skeleton";
import { ease } from "@/components/ui/motion";

// The textarea grows with content up to this height, then scrolls
// internally instead of pushing the rest of the page around.
const MAX_INPUT_HEIGHT_PX = 160;
const PAGE_SIZE = 40;

const PROMPTS = [
  "Protein left today",
  "Calories in 200g paneer",
  "Add 3 eggs to breakfast",
  "My maintenance calories",
];

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <m.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-on-surface-variant"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

export default function CoachPage() {
  const { session, loading: sessionLoading } = useSession();
  const [messages, setMessages] = useState<CoachMessage[] | null>(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Scroll to the newest message only when one is added at the END -- not
  // when older messages are prepended by "Load earlier".
  const scrollOnNext = useRef(true);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Recompute from scratch on every change so shrinking (e.g. after
    // deleting text, or after sending clears the field) works too, not
    // just growth.
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [input]);

  useEffect(() => {
    if (!session) return;
    fetchCoachHistory()
      .then((rows) => {
        setMessages(rows);
        setHasEarlier(rows.length >= PAGE_SIZE);
      })
      .catch((err) => setError(friendlyMessage(err, "coach-history")));
  }, [session]);

  useEffect(() => {
    if (!scrollOnNext.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  if (sessionLoading) {
    return (
      <main aria-busy="true" className="flex flex-1 justify-center px-4 py-6">
        <div className="w-full max-w-2xl space-y-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="ml-auto h-12 w-1/2" />
        </div>
      </main>
    );
  }
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

  async function loadEarlier() {
    if (!messages || messages.length === 0 || loadingEarlier) return;
    setLoadingEarlier(true);
    scrollOnNext.current = false;
    try {
      const older = await fetchCoachHistory(messages[0].created_at);
      setMessages((prev) => [...older, ...(prev ?? [])]);
      setHasEarlier(older.length >= PAGE_SIZE);
    } catch (err) {
      setError(friendlyMessage(err, "coach-history"));
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    const userMessage: CoachMessage = {
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };
    scrollOnNext.current = true;
    setMessages((prev) => [...(prev ?? []), userMessage]);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const reply = await sendCoachMessage(content);
      scrollOnNext.current = true;
      setMessages((prev) => [...(prev ?? []), reply]);
    } catch (err) {
      setError(friendlyMessage(err, "coach-message"));
    } finally {
      setSending(false);
      // Keeps the caret in the input after sending, matching a normal
      // chat input's feel instead of leaving focus stranded on the
      // (now-disabled) Send button.
      textareaRef.current?.focus();
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <main className="flex flex-1 flex-col px-4 pt-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <header className="mb-4">
          <p className="eyebrow">Ask · Log · Learn</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-on-surface sm:text-4xl">
            Coach
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Ask about your macros, BMI, or nutrition — not a substitute for medical advice.
          </p>
        </header>

        <div className="flex-1 space-y-3 pb-4" aria-live="polite">
          {hasEarlier && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={loadEarlier}
                disabled={loadingEarlier}
                className="rounded-full border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-60"
              >
                {loadingEarlier ? "Loading…" : "Load earlier messages"}
              </button>
            </div>
          )}

          {messages === null ? (
            <div aria-busy="true" className="space-y-3">
              <Skeleton className="h-14 w-3/4" />
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-20 w-4/5" />
            </div>
          ) : messages.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-outline-variant p-5 text-sm text-on-surface-variant">
              Ask something like &quot;How much protein do I have left?&quot;, &quot;How many
              calories are in 200g paneer?&quot;, or &quot;Add 3 eggs to breakfast.&quot;
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {messages.map((message, i) => {
                const mine = message.role === "user";
                return (
                  <m.div
                    key={`${message.created_at}-${i}`}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.3, ease: ease.out }}
                    className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
                  >
                    {!mine && <LogoMark size={26} />}
                    <div
                      className={`max-w-[82%] rounded-[var(--radius-card)] px-4 py-3 text-sm leading-relaxed ${
                        mine
                          ? "rounded-br-md bg-primary text-on-primary"
                          : "card rounded-bl-md bg-surface-container-lowest text-on-surface"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{message.content}</p>
                      {message.action && (
                        <a
                          href="/today"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                        >
                          View in Today
                          <Icon name="arrow_forward" className="text-sm" />
                        </a>
                      )}
                    </div>
                  </m.div>
                );
              })}
            </AnimatePresence>
          )}

          {sending && (
            <div role="status" aria-live="polite" className="flex items-center gap-2 pl-9 text-xs text-on-surface-variant">
              <TypingDots />
              <span>Coach is thinking…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-24 z-10 -mx-1 bg-gradient-to-t from-surface via-surface to-transparent px-1 pb-2 pt-4 lg:bottom-0 lg:pb-5">
          {error && (
            <p role="alert" className="mb-2 text-sm text-fat">
              {error}
            </p>
          )}
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => send(prompt)}
                disabled={sending}
                className="flex-shrink-0 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
          <form ref={formRef} onSubmit={handleSend} className="card flex items-end gap-2 rounded-[1.5rem] p-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the coach…"
              aria-label="Message Coach"
              rows={1}
              className="max-h-40 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2 text-sm leading-snug text-on-surface outline-none placeholder:text-on-surface-variant/70"
              style={{ maxHeight: MAX_INPUT_HEIGHT_PX }}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition-transform active:scale-90 disabled:opacity-40"
            >
              <Icon name="arrow_forward" className="text-lg" />
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
