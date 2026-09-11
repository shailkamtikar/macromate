"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FriendActivityItem,
  Friendship,
  LeaderboardEntry,
  UserSearchResult,
  fetchFriendActivity,
  fetchFriendships,
  fetchLeaderboard,
  respondToFriendRequest,
  searchUsers,
  sendFriendRequest,
} from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";
import { useSession } from "@/lib/useSession";

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "a snack",
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// A calm, bounded refresh so friend activity feels reasonably live without
// polling aggressively or standing up a new realtime channel/RLS surface
// for food_logs (which is intentionally owner-only).
const ACTIVITY_REFRESH_MS = 60_000;

export default function FriendsPage() {
  const { session, loading: sessionLoading } = useSession();
  const [friendships, setFriendships] = useState<Friendship[] | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [activity, setActivity] = useState<FriendActivityItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [f, l, a] = await Promise.all([fetchFriendships(), fetchLeaderboard(), fetchFriendActivity()]);
      setFriendships(f);
      setLeaderboard(l);
      setActivity(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load friends.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, standard pattern
    if (session) reload();
  }, [session, reload]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(reload, ACTIVITY_REFRESH_MS);
    return () => clearInterval(id);
  }, [session, reload]);

  // Real Supabase Realtime: both participants can already read their own
  // friendship rows under existing RLS, so subscribing here doesn't
  // expose anything a plain query wouldn't — it just avoids polling.
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel("friendships-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friendships" },
        () => {
          reload();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, reload]);

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

  async function handleSearch(q: string) {
    setQuery(q);
    setError(null);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      setResults(await searchUsers(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    }
  }

  async function handleSendRequest(username: string) {
    setError(null);
    setNotice(null);
    try {
      await sendFriendRequest(username);
      setNotice(`Friend request sent to ${username}.`);
      setQuery("");
      setResults([]);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send request.");
    }
  }

  async function handleRespond(id: string, accept: boolean) {
    setError(null);
    try {
      await respondToFriendRequest(id, accept);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't respond.");
    }
  }

  const incoming = (friendships ?? []).filter(
    (f) => f.status === "pending" && f.addressee_id === session.user.id,
  );
  const outgoing = (friendships ?? []).filter(
    (f) => f.status === "pending" && f.requester_id === session.user.id,
  );
  const accepted = (friendships ?? []).filter((f) => f.status === "accepted");

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6">
      <div className="w-full max-w-2xl space-y-4">
        <header>
          <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
            Friends
          </h1>
          <p className="text-sm text-on-surface-variant">
            Compare weekly discipline scores and stay accountable together.
          </p>
        </header>

        <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
          <input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by username…"
            className="input w-full"
          />
          {results.length > 0 && (
            <ul className="mt-2 space-y-1">
              {results.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between rounded-[var(--radius-control)] bg-surface-container-low px-3 py-2"
                >
                  <span className="text-sm text-on-surface">{u.username}</span>
                  <button
                    onClick={() => handleSendRequest(u.username)}
                    className="rounded-[var(--radius-control)] bg-primary-container px-3 py-1 text-xs font-semibold text-on-primary"
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="text-sm text-fat">{error}</p>}
        {notice && <p className="text-sm text-primary">{notice}</p>}

        {incoming.length > 0 && (
          <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-on-surface">Requests</h2>
            {incoming.map((f) => (
              <div key={f.id} className="flex items-center justify-between py-1.5">
                <span className="text-sm text-on-surface">{f.other_username}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRespond(f.id, true)}
                    className="rounded-[var(--radius-control)] bg-primary px-3 py-1 text-xs font-semibold text-on-primary"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleRespond(f.id, false)}
                    className="rounded-[var(--radius-control)] bg-surface-container px-3 py-1 text-xs font-semibold text-on-surface-variant"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {outgoing.length > 0 && (
          <p className="text-xs text-on-surface-variant">
            Pending: {outgoing.map((f) => f.other_username).join(", ")}
          </p>
        )}

        <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-on-surface">This week&apos;s leaderboard</h2>
          {leaderboard === null ? (
            <p className="text-sm text-on-surface-variant">Loading…</p>
          ) : leaderboard.length <= 1 ? (
            <p className="text-sm text-on-surface-variant">
              Add friends to see how you compare.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {leaderboard.map((entry, i) => (
                <li
                  key={entry.user_id}
                  className={`flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2 ${
                    entry.is_self ? "bg-primary-container/40" : "bg-surface-container-low"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm text-on-surface">
                    <span className="text-xs font-semibold text-on-surface-variant">#{i + 1}</span>
                    {entry.username}
                    {entry.is_self && <span className="text-xs text-primary">(you)</span>}
                    {entry.current_streak_days > 0 && (
                      <span className="flex items-center gap-0.5 text-xs text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm" aria-hidden="true">
                          local_fire_department
                        </span>
                        {entry.current_streak_days}
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-semibold text-on-surface">
                    {entry.discipline_score}%
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {accepted.length > 0 && (
          <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-on-surface">Friend activity</h2>
            {activity === null ? (
              <p className="text-sm text-on-surface-variant">Loading…</p>
            ) : activity.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No recent friend activity yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {activity.map((item) => (
                  <li
                    key={`${item.user_id}-${item.meal_type}-${item.logged_at}`}
                    className="reveal-in flex items-center justify-between text-sm text-on-surface"
                  >
                    <span>
                      <span className="font-medium">{item.username}</span> added{" "}
                      {MEAL_LABELS[item.meal_type] ?? item.meal_type} 🍽️
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      {relativeTime(item.logged_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {accepted.length === 0 && incoming.length === 0 && (
          <p className="text-xs text-on-surface-variant">
            No friends yet — search above by username to add someone.
          </p>
        )}
      </div>
    </main>
  );
}
