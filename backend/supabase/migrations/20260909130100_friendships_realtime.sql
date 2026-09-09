-- Enables Supabase Realtime (postgres_changes) on friendships so the
-- Friends page updates live when a request is sent/accepted, without
-- polling. Safe under existing RLS: both participants of a friendship row
-- can already SELECT it (friendships_select_participant), so Realtime —
-- which replays through the same RLS for authenticated subscribers —
-- exposes nothing a direct query wouldn't.
alter publication supabase_realtime add table public.friendships;
