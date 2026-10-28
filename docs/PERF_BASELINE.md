# Performance baseline (before upgrades)

Measured 2026-10-28 on the developer PC: local backend (`127.0.0.1:8000`) talking to the **TEST** Supabase project (Asia-Pacific), seeded user A (35 days, 172 food logs, 1 friend). Median of 5 runs, warm, includes JWT verification. Network from this PC to Supabase is ~220 ms per request (new TLS connection each time ≈ 240–410 ms; keep-alive ≈ 200–250 ms). Production (Render, same region as Supabase) will be faster in absolute terms; the **ranking and ratios** are what matter.

| Endpoint | Median ms | Max ms | Notes |
|---|---:|---:|---|
| /api/glass-sizes | 272 | 289 | 1 DB call |
| /api/foods/recent | 270 | 278 | 1 DB call |
| /api/water-logs | 519 | 542 | profile + logs |
| /api/food-logs | 531 | 859 | profile + logs |
| /api/achievements | 829 | 1063 | profile + 90 days logs + weights |
| /api/notification-settings/check-now | 837 | 891 | profile + settings + 60 days logs (polled every 5 min per open tab) |
| /api/progress/weekly | 1028 | 1232 | |
| /api/friends/activity | 1034 | 1137 | |
| **/api/suggestions** | **1041** | 2358 | ~5 sequential DB calls + 300-row join |
| **/api/friends/leaderboard** | **1762** | 2120 | 2 queries per friend + friendships |

## Findings

- The dashboard issued `food-logs`, `water-logs`, `glass-sizes` and `suggestions` in one `Promise.all` and showed nothing until the slowest (suggestions, 1+ s here, much worse with Gemini-sized contention) finished.
- Every backend DB call opens a new TLS connection (`httpx.request`), adding 40–190 ms each; endpoints make 2–10 sequential calls.
- `localhost` on Windows resolves to IPv6 first and costs a 2 s fallback for non-browser clients; use `127.0.0.1` for scripts.
- All routes are dynamic (server-rendered) because the root layout reads the theme cookie.

## Budgets for this upgrade

- Today diary visible ≤ 1.5 s after login on warm backend (Fast 4G).
- Non-AI endpoint p95 < 500 ms on production hardware.
- `/today` JS: no more than +40 KB gzip over the baseline build.

Reproduce: `backend/.venv/Scripts/python.exe <bench script>` (see git history of this file for the script description) — logs in as tester A through Supabase Auth and times each endpoint 5×.
