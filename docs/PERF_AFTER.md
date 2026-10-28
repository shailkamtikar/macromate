# Performance after the upgrade

Same method as [`PERF_BASELINE.md`](PERF_BASELINE.md): local backend (`127.0.0.1:8000`) → TEST Supabase project, seeded user A, median of 5 warm runs, PC→Supabase ≈ 220 ms per round-trip.

| Endpoint | Before (ms) | After (ms) | What changed |
|---|---:|---:|---|
| /api/suggestions | 1041 | **17** cached / ~850 cold | pooled keep-alive connections, reads in parallel, 45 s per-user cache invalidated on every food change |
| /api/friends/leaderboard | 1762 | **840** | per-friend reads run concurrently |
| /api/achievements | 829 | **423** | reads in parallel |
| /api/notification-settings/check-now | 837 | **419** | reads in parallel |
| /api/progress/weekly | 1028 | **740** | both week summaries + weights in parallel |
| /api/food-logs | 531 | 418 | pooled connections |
| /api/glass-sizes | 272 | 205 | pooled connections |

## What the user feels

- **Today no longer waits for "What to eat next".** The diary, totals and water render from one request (`GET /api/days/{date}`); suggestions and the streak chip load afterwards with their own skeleton/retry. A deliberately slowed `/api/suggestions` (6 s) does not delay the diary (e2e `dashboard-progressive.spec.ts`).
- **AI is isolated from data.** AI calls go through a separate client (40 s budget vs 15 s), a concurrency cap (4) and per-user limits. During a burst of 6 simultaneous AI requests, plain data calls stayed at ~220–310 ms (before the cap they queued behind them).
- **AI itself is ~2× faster:** native JSON mode and no hidden "thinking" for parsing/intent calls — a 4-way burst went from 5.4/8.1/14.6/23 s to 3.3/3.8/9.3/10 s.
- **Repeat visits are instant.** Pages and dates already seen come from the TanStack Query cache and refresh quietly in the background; icons are inline SVG (no third-party icon-font request).

Cold start: not applicable (UptimeRobot pings `/health` every 5 min); the app also pings `/health` on load and shows a "Waking the server…" hint if the first call is slow.
