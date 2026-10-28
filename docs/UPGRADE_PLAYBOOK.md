# MacroMate — Upgrade Playbook

**Status:** Draft from the review pass on 2026-10-27. Nothing here is implemented yet.
**Scope reviewed:** the whole repo — `backend/` (FastAPI, 11 routers, 12 domain modules, 20 migrations, 29 test files), `frontend/` (Next.js 16 / React 19 PWA, 12 routes, 27 components, 21 Playwright specs), `docs/`, config and deploy hygiene.
**Method:** read every router, core module and page, plus the schema/RLS/grant migrations. Ran `tsc`, `eslint` and `npm audit` on the frontend. Did **not** run the backend tests (they hit the live Supabase project) or the e2e suite (they hit live Gemini). Findings marked *(verified)* were confirmed against the code. Nothing was exercised against production.

---

## 0. How to use this playbook

1. **Add your upgrade list in §9.** You said a few changes are coming. This doc is the map of what's solid, what's fragile, and what each of your changes will collide with.
2. Work in the **phase order in §8** unless a change of yours forces a reorder. Phase 0 and 1 are small and should go first no matter what.
3. Each item has an **ID** (e.g. `SEC-2`) so we can reference it in commits and sessions. Size is S (<½ day), M (≈1–2 days), L (≈3+ days).
4. Every item lists **how to verify**. We don't call something done without it.

---

## 1. What the app is today (so we agree on the baseline)

| Layer | Reality |
|---|---|
| Frontend | Next.js 16.3.4, React 19.2, Tailwind 4, supabase-js. Client-rendered pages behind a client-side session gate. PWA with a small service worker (offline page + local notifications only). |
| Backend | FastAPI, stateless, **service-role key for every DB call** (RLS is bypassed on the backend; authz is hand-written `user_id` scoping). Supabase accessed via raw PostgREST over `httpx`. |
| Data | Supabase Postgres, RLS on all tables. Frontend *also* talks to Supabase directly for `profiles`, `weight_logs`, and Realtime `friendships`. |
| AI | Gemini via one wrapper (`core/gemini.py`): primary + fallback model, prompt-for-JSON, parse by hand. Used by Coach, AI Calculator, Diet generator. All numbers are deterministic; AI only parses/phrases. |
| Notifications | Deterministic trigger logic is real. **Delivery is in-tab polling only** — `core/fcm.py` is an intentional stub. Nothing reaches a closed app. |
| Health data | Manual entry only (documented platform limitation). |
| Tests | Strong domain unit coverage; API and e2e tests run against live services. No CI. |

**What's genuinely good and should be protected during upgrades:**
- The "AI never produces numbers" rule, and the ambiguity/estimate provenance model (`database` vs `ai_estimate`) carried all the way to the UI.
- Immutable nutrition snapshots on `food_logs`; timezone-correct day/week bucketing (`timeutil`), including friends in other timezones.
- Optimistic updates with rollback and the `mutationVersion` stale-response guard on Today.
- Privacy discipline on friend activity (presence only, no foods/macros) and the leaderboard opt-out.
- Migration hygiene and the habit of documenting *why* in comments.

---

## 2. Priority findings

### 2.1 Security & data integrity (fix first)

**SEC-1 — Next.js has a critical advisory set.** *(verified: `npm audit`)* `next@16.3.4` is inside `16.0.0–16.4.0`, which carries one critical and several high advisories (RCE in `next/og` and image optimization, cache poisoning on self-hosted SSG/ISR, Server Actions DoS). `sharp` and `source-map-js` are also flagged (both fixable without `--force`). The pinned `next`/`eslint-config-next` need to move to ≥ 16.4.3.
→ *Size S.* Bump `next`, `eslint-config-next`, run `npm audit fix`, rebuild, run e2e. *Verify:* `npm audit --omit=dev` is clean; `next build` passes. Check which advisories actually apply to how you deploy (Vercel vs self-hosted) but upgrade regardless.

**SEC-2 — A user can approve their own friend request straight from the browser.** *(verified)* `friendships_update_participant` lets **either** participant update the row with no column restriction, and `authenticated` has `UPDATE` on `friendships`. With the public anon key and their own JWT, a requester can `update friendships set status='accepted'` on a request they sent. The API's "only the addressee may respond" check is bypassed. That grants them leaderboard rows and friend activity of anyone they pick (subject to `leaderboard_visible`, which defaults to **true**).
→ *Size S.* Tighten the policy (addressee only may move `pending → accepted/declined`; requester may only delete). Or revoke client `UPDATE` and keep all friendship writes behind the API. Add an RLS test in `test_rls.py`.

**SEC-3 — Users can mint "verified" foods.** *(verified)* `food_items_insert_authenticated` only checks `created_by = auth.uid()`; it does not stop `verified = true` (or `is_ai_estimate = false/true`). The `update_own_unverified` policy's `WITH CHECK` also doesn't forbid setting `verified = true`. Verified rows get ranked first in search and suggestions for *everyone*. This undermines the shared-DB trust model (PRD §3.2).
→ *Size S.* Column-level: revoke client `INSERT/UPDATE` on `food_items` entirely (the backend already creates foods) or add `verified = false` to both `WITH CHECK` clauses and a trigger blocking changes to `verified`. Add RLS tests.

**SEC-4 — Targets are client-computed and trusted, which makes the leaderboard gameable.** *(verified)* `profile/page.tsx` and `onboarding/page.tsx` write `target_calories/protein/carbs/fat` straight to `profiles` from the browser. The schema comment says "never computed client-side". The discipline score is `adherence_pct` against `target_calories` (`friends.py`). Set a huge calorie target and you hit your goal every day.
→ *Size M.* Add `PUT /api/profile` that takes the *inputs*, recomputes targets with the existing `macros.py`, and writes `profiles` and `weight_logs` in one request. Then revoke client `UPDATE` on the computed columns. This also removes the duplicated "mirrors server-side" constants in `api.ts`.

**SEC-5 — Gemini key in the query string and raw upstream errors returned to clients.** *(verified)* `gemini.py` sends `?key=...` and builds exceptions from `resp.text[:300]` / transport errors. Those strings are returned verbatim to the browser (`detail=f"Coach is temporarily unavailable: {exc}"`, same in `ai_food.py`, `diet.py`). Query-string keys also land in proxy/access logs.
→ *Size S.* Send the key as the `x-goog-api-key` header. Log the detail server-side; return a fixed user-safe message. Same for the JWT error detail in `auth.py`.

**SEC-6 — No rate limiting or quota on AI endpoints.** `coach/message`, `ai/calculate-foods` and `ai/generate-diet` each call Gemini (up to 20–25 s primary + 8 s fallback) with only a signed-in user as the gate; signup is open. A single account can burn the free-tier quota for everyone, and each call pins a worker thread. The PRD calls for token-usage logging for cost control; today it's a log line only.
→ *Size M.* Per-user limits (e.g. N/min and N/day) in a small `ai_usage` table or Redis; record model, tokens, latency per call. Return 429 with a calm message the UI already knows how to show (`lib/errors.ts`). Decide the numbers with the user-facing plan in mind (§9).

**SEC-7 — Secrets hygiene.** `.codex/config.toml` is **untracked but contains a Stitch API key in plaintext**, and root `.env` holds the same key (twice). `.codex/` is not in `.gitignore`, so one `git add .` would publish it. → *Size S.* Add `.codex/` to `.gitignore`, **rotate that Stitch key** (it's now in this session's transcript too), and keep MCP keys in env vars rather than config files.

**SEC-8 (low) — Friend search enumerates users.** `GET /friends/search` does `ilike *q*` on usernames for any 2+ chars with no rate limit and ignores `leaderboard_visible`. Acceptable for a small friend app; consider exact-match or invite codes if you grow (PRD also lists email/invite-link). Also confirm production `CORS_ALLOW_ORIGINS` is set to the real frontend origin (the default is localhost only).

### 2.2 Bugs found while reading *(verified in code)*

| ID | Where | Problem | Size |
|---|---|---|---|
| BUG-1 | `routers/coach.py` `get_history` | Orders `created_at.asc` with `limit=100` → returns the **oldest** 100 messages. After 100 messages the Coach page never shows new ones, and replies "disappear" on reload. Should fetch newest 100 and reverse; add pagination (PRD asks for it). | S |
| BUG-2 | `domain/coach.py` `deterministic_fast_path` | "What are my maintenance calories?" returns the *goal target* (e.g. the cut number), not maintenance. The context doesn't carry TDEE. It's a PRD example question. Also `protein.*(left\|remain)` will intercept "how much protein is left in 200g paneer" style questions. | S |
| BUG-3 | `routers/coach.py` `_load_context` | `latest_weight = ... else profile.get("height_cm")` falls back to **height** when there are no weight logs, so BMI is wrong in that case. | S |
| BUG-4 | `domain/food_resolution.py` `get_or_create_personal_food` | Selects **every** `food_items` row the user created on each AI-estimate log, filters in Python, and has no unique constraint → grows over time and double-submit can create duplicates. Needs a partial unique index on `(created_by, lower(name)) where is_ai_estimate` and an upsert. | S |
| BUG-5 | `NotificationPoller` | De-dupe key is `kind:today`, so a user with several reminder times only ever gets the first logging reminder of the day. | S |
| BUG-6 | `routers/water.py` `delete_glass_size` | Returns 204 for a non-existent/foreign id (no existence check, unlike food-log delete). Harmless but inconsistent. | S |
| BUG-7 | `sw.js` header comment | Says static assets are cached "fingerprinted", but only 4 icon files are in `SHELL_ASSETS`; Next's `_next/static` bundles aren't cached, so the app doesn't actually load offline. Either fix the comment or build real offline (see FE-8). | S |

### 2.3 Performance & scalability

**PERF-1 — No connection reuse to Supabase.** `SupabaseAdmin._request` calls `httpx.request(...)` each time, which opens a new TCP+TLS connection per DB call. A single Coach message performs ~10 sequential PostgREST calls (history, insert, profile, weights, food, water, activity, weekly×3). Use one module-level `httpx.Client` (keep-alive, HTTP/2, pooled) — expect a large latency drop for ~10 lines of change. *Size S.*

**PERF-2 — Sync handlers + blocking `httpx` for 20–28 s Gemini calls.** Handlers are plain `def`, so they run in FastAPI's 40-thread pool; ~40 concurrent slow AI calls starve every other endpoint. Move the Gemini wrapper and `SupabaseAdmin` to `httpx.AsyncClient` and make hot routers `async`, or isolate AI routes. *Size M.*

**PERF-3 — Aggregation done in Python after fetching raw rows.** Today/Progress/Coach/Achievements/Notifications each pull up to 60–90 days of `food_logs` and sum in Python. The leaderboard does **2 queries per friend**, polled every 60 s by two components (Friends page reload + `NotificationPoller`). Replace with SQL functions/views (daily totals per user, leaderboard in one RPC). *Size M–L.*

**PERF-4 — Polling load.** Each open tab hits `check-now` every 5 min (60-day log scan) and `friends/activity` every 60 s; the Friends page additionally reloads three endpoints every 60 s. With real push (§3.1) the trigger poll can go away; friend activity can use Realtime on a small, RLS-safe `friend_events` table instead of polling.

**PERF-5 — Frontend payload.** Material Symbols is a render-blocking Google Fonts `<link>` in `layout.tsx` (also the one ESLint warning). Swap to an inline SVG icon set. `recent_foods` and `suggestions` both re-scan up to 300 `food_logs` joined to `food_items`.

### 2.4 Architecture / maintainability

- **FE-1 — No data layer.** Every page hand-rolls fetch/loading/error/retry; Today has a bespoke `mutationVersion` guard to stop stale responses. TanStack Query (or SWR) gives caching, dedupe, invalidation and optimistic mutations, and would delete a lot of Today's 700 lines. Also removes the "Loading…" flashes between routes.
- **FE-2 — Hand-mirrored API types.** `api.ts` (668 lines) duplicates every Pydantic model and server constant. Generate types from FastAPI's OpenAPI (`openapi-typescript`) and split the client per domain.
- **FE-3 — Auth is client-only.** Each page re-implements "not signed in → Log in link" (Today redirects, others don't). Use `@supabase/ssr` + a Next middleware/proxy so routes are protected before render and the session survives SSR; it also fits the existing server-read theme cookie.
- **FE-4 — Component coupling.** `AppSidebar` imports `app/profile/page` (a route) as a component. Extract a `ProfileEditor`. Today (722), FoodPicker (616), AppSidebar (400), TargetsEditor (446) are all candidates for splitting.
- **FE-5 — Two write paths to the same data.** Profile/weight go browser→Supabase; everything else goes browser→API. This is the root of SEC-4 and makes validation/rules inconsistent. Pick one (API) per domain.
- **FE-6 — `NEXT_PUBLIC_API_URL` silently falls back to `http://localhost:8000`.** A misconfigured production build would call the user's own localhost. Fail the build if unset in production.
- **FE-7 — UX details:** `window.confirm` on delete (use undo-toast, which fits the optimistic model); no weight-logging UI outside Profile save (so "weight lower than last" celebrations need a profile edit to trigger); no confetti/animation for achievements despite PRD §3.8 (cards only).
- **FE-8 — PWA is installable but not offline-capable** (BUG-7) and has no `push` handler.
- **BE-1 — `main.py` carries the macro-targets endpoint and models** while every other feature has a router. Move to `routers/macros.py`.
- **BE-2 — Single `SupabaseAdmin` PostgREST wrapper with stringly-typed filters** (`f"in.({','.join(ids)})"`, `ilike.*{q}*`). Fine today; a small typed query helper (or `supabase-py`/`postgrest-py`) reduces injection-by-formatting risk as more filters are added. Note user-controlled `q` is passed into PostgREST filter syntax unescaped.
- **BE-3 — Gemini JSON by prompt only.** The wrapper doesn't use Gemini's native JSON mode (`responseMimeType: application/json` + `responseSchema`); parsers strip markdown fences and fail with 502s on malformed output. Native structured output should cut those failures and remove `_strip_markdown_fence`. Also set `temperature` low for parsing tasks and read `finishReason`/safety blocks (currently a blocked response raises `KeyError → GeminiError`).
- **BE-4 — Model IDs are config only** (`gemini-3.6-flash` / `3.5-flash-lite` from the PRD). Confirm they're what production actually runs and that the fallback has been exercised; add a startup/health check that reports which model answered.

### 2.5 Testing, CI, deploy

- **OPS-1 — No CI.** No `.github/`. 3 ESLint **errors** exist today (`scripts/generate-icons.js` uses `require`; rename to `.cjs` or ignore), so `npm run lint` already fails. Add a CI workflow: `tsc`, `eslint`, backend `pytest` (non-live), `next build`.
- **OPS-2 — Tests depend on production-like live services.** `test_rls.py` and the API tests create throwaway users on the **real** Supabase project; e2e calls real Gemini (hence `retries: 1`). Introduce: local Supabase (`supabase start` + migrations) for CI; a fake Gemini transport for deterministic tests; keep a small tagged "live" smoke set.
- **OPS-3 — Deploy is undocumented in the repo.** No Dockerfile, `vercel.json`, `render.yaml`, or runbook; root README is empty, frontend README is still the create-next-app template. Write a `docs/DEPLOY.md` (hosts, env vars, migration process, rollback). **I don't know where the backend/frontend are hosted — see §9.**
- **OPS-4 — Observability.** Only `logging` lines. Add request IDs, structured logs, error tracking (Sentry), and a basic uptime check on `/health` (which currently doesn't test Supabase/Gemini reachability).
- **OPS-5 — Housekeeping.** Remove unused starter SVGs from `public/`; `backend/app/**/__pycache__` should stay ignored (it is); document `uv` + Node versions; drop the 11-file `.pyc` noise from searches via ignore.

---

## 3. Feature gaps vs. the PRD (likely upgrade candidates)

| # | PRD item | Today | Gap / what's needed |
|---|---|---|---|
| 3.1 | §3.4 Push notifications | Trigger logic ✔; delivery = in-tab polling only; `fcm.py` raises `FcmNotConfigured` | Real Web Push. Needs: `push_subscriptions` table, VAPID or FCM **HTTP v1** (legacy server keys are deprecated — the current `FCM_SERVER_KEY` design is dead on arrival), `push` handler in `sw.js`, permission UX, and a **scheduler** (cron: Supabase `pg_cron`/Edge Function, host cron, or GitHub Actions) calling an internal dispatch endpoint. iOS requires the PWA to be installed to Home Screen. |
| 3.2 | §3.9 Health data | Manual steps/workouts only | Not possible from a PWA. Options: Capacitor/TWA wrapper with a Health Connect plugin (Android), HealthKit later; or integrate a cloud API (Google Fit is deprecated; Strava/Garmin/Fitbit/Oura OAuth). Decide before investing — see §9. |
| 3.3 | §3.2 Custom foods / moderation | Create + dupe detection ✔ | No report endpoint/UI (`food_item_reports` table is unused), no admin review, no "added by", no edit/delete of own custom food, **no seed of verified foods in migrations** (where did the verified DB come from?). |
| 3.4 | §3.7 Weekly reports | In-app card ✔, cached per completed week | No push/email delivery, no AI commentary (PRD open question). |
| 3.5 | §3.3 Coach | Works, intent-based actions | History pagination (BUG-1), per-user quota (SEC-6), streaming responses, weekly check-in, richer actions (log weight, edit quantity). |
| 3.6 | §3.8 Celebrations | Cards/chips | Animations/confetti, weight-log entry point, milestone toasts. |
| 3.7 | §7 Out-of-scope items that users commonly expect | — | Barcode scanning, dietary filters (only a 3-value `dietary_mode` exists, used by diet generator), meal plans saved to diary, recipes, imperial units, i18n. |
| 3.8 | Account lifecycle | Email+password via Supabase | No password reset UI, no email-change, **no account/data deletion or export** (needed for store listing / GDPR-style requests), password min 6, no OAuth (Google), no onboarding resume. |

---

## 4. Per-area upgrade notes (for when we touch each file)

**Backend**
- `core/supabase_admin.py` → shared client (PERF-1), async option (PERF-2), typed filters (BE-2).
- `core/gemini.py` → header auth, JSON mode, usage table, safety/`finishReason`, async (SEC-5, SEC-6, BE-3).
- `routers/coach.py` → history order/pagination, remove weight→height fallback, SQL aggregates (BUG-1/3, PERF-3).
- `routers/friends.py` → leaderboard RPC (PERF-3), respond/search hardening (SEC-2/8).
- `routers/notifications.py` + `core/fcm.py` → real delivery + dispatcher (§3.1).
- `main.py` → move macro-targets into a router; add `/api/profile` (SEC-4).

**Database** (new migrations; remember the one-timestamp-prefix rule in `docs/DATABASE.md`)
1. Tighten `friendships` update policy (SEC-2).
2. Lock down `food_items` verified/is_ai_estimate (SEC-3); add partial unique index (BUG-4).
3. Revoke client writes to computed `profiles` columns (SEC-4).
4. `ai_usage`, `push_subscriptions` tables; leaderboard/daily-totals SQL functions (SEC-6, §3.1, PERF-3).
5. Optional: indexes check on `food_logs (user_id, logged_at)` ✔ exists; add `(user_id, food_item_id)` for recent/frequent.

**Frontend**
- Introduce query layer + generated types (FE-1/2), auth middleware (FE-3), extract `ProfileEditor` (FE-4), icon swap (PERF-5), push UX + SW `push` handler (§3.1), undo-toast pattern (FE-7).
- Keep `data-testid`s stable; 21 Playwright specs depend on them.

---

## 5. Risks to watch while upgrading

1. **Next 16.3 → 16.4.x** is a minor bump but the config has `agentRules: false` (an unusual flag) — confirm it still exists after the bump, and re-run all e2e.
2. **Revoking client writes** (SEC-2/3/4) will break any frontend path still writing directly. Order matters: ship the API endpoint and switch the frontend **first**, revoke grants **second**, behind a migration you can roll back.
3. **Switching to async httpx** touches every router; do it behind the shared client first (PERF-1), measure, then decide if full async is worth it.
4. **Live-service tests** can create real users/rows. Don't run `pytest` or e2e casually against production credentials until OPS-2 is done.
5. **Push on iOS** only works for installed PWAs (iOS 16.4+); set expectations in the UI.
6. **Historical data:** completed-week `weekly_reports` are cached and immutable by design — a change to adherence math won't rewrite history; that's intended, but communicate it if you change the formula.

---

## 6. Dependencies between items

```
OPS-2 (safe test env) ─► PERF-2 async migration, SEC-2/3/4 RLS changes
SEC-4 (/api/profile) ─► revoke profiles client writes ─► FE-5 single write path
PERF-1 shared client ─► PERF-2 async ─► PERF-3 SQL aggregates
§3.1 push ─► scheduler decision ─► PERF-4 remove trigger polling
FE-1 data layer ─► FE-7 undo-toast, shrink Today page
```

---

## 7. Definition of done for any item

- Code + migration + test (unit or RLS test where relevant) in the same change.
- `tsc`, `eslint`, backend `pytest` (non-live subset), `next build` all green.
- Relevant e2e spec(s) pass, or a new one added.
- Docs updated (`DATABASE.md` for schema, this file's checkbox).
- For DB changes: migration applied to a non-prod branch/project first.

---

## 8. Suggested phases

**Phase 0 — Safe hygiene (≈½ day, no behavior change)**
- [ ] SEC-7 ignore `.codex/` + rotate Stitch key
- [ ] SEC-1 bump Next / audit fix
- [ ] OPS-1 fix the 3 ESLint errors; add minimal CI
- [ ] FE-6 fail build when `NEXT_PUBLIC_API_URL` unset
- [ ] BUG-6, BUG-7 trivial fixes

**Phase 1 — Close the trust holes (≈2–3 days)**
- [ ] SEC-2 friendships policy
- [ ] SEC-3 food_items policy + BUG-4 unique index
- [ ] SEC-5 Gemini key header + sanitized errors
- [ ] SEC-4 `/api/profile` + switch frontend + revoke grants
- [ ] RLS tests for all of the above

**Phase 2 — Correctness & cost control (≈2 days)**
- [ ] BUG-1, BUG-2, BUG-3, BUG-5
- [ ] SEC-6 rate limits + `ai_usage`
- [ ] BE-3 Gemini JSON mode / safety handling
- [ ] OPS-2 local Supabase + fake Gemini for CI

**Phase 3 — Speed (≈3–5 days)**
- [ ] PERF-1 shared client → measure
- [ ] PERF-3 SQL aggregates (leaderboard, daily totals, achievements)
- [ ] PERF-5 icon swap
- [ ] PERF-2 async (only if measurement says so)

**Phase 4 — Frontend foundation (≈4–6 days)**
- [ ] FE-2 generated types, FE-1 query layer, FE-3 SSR auth
- [ ] FE-4 split big components, FE-7 undo-toast

**Phase 5 — Product features (sized after §9)**
- [ ] §3.1 real push + scheduler
- [ ] §3.8 account deletion/export, password reset
- [ ] §3.3 food reports/moderation/seed data
- [ ] §3.2 health data direction

---

## 9. Your input needed (fill in before we implement)

### 9.1 The upgrades you have in mind
> *Write them here as bullets — rough is fine. For each, note: who it's for, and whether it's "must have for launch" or "nice to have".*

- [ ]
- [ ]
- [ ]

### 9.2 Questions I couldn't answer from the code

1. **Where are the frontend and backend hosted** (Vercel? Render/Fly/Railway/Cloud Run?) and how do deploys happen? This decides cold-start strategy, the cron option for push, and whether the Next advisories apply (self-hosted vs Vercel).
2. **Who are the users right now?** Friends/beta vs public. This sets how urgent SEC-2/3/4/6 are and whether signup needs email confirmation/captcha.
3. **Where did the verified food database come from?** No seed exists in migrations — is it manually inserted in production? Do we need a reproducible seed (and a source like USDA/IFCT/Open Food Facts)?
4. **Is Supabase email confirmation on?** Affects abuse controls and the signup flow.
5. **Free tiers in use?** (Supabase, Gemini, hosting.) Determines the rate-limit numbers and whether PERF work is about cost or latency.
6. **Stitch/design:** do your upcoming changes come with new Stitch screens (the `.codex`/Stitch MCP setup suggests yes)? If so, `docs/DESIGN_RECONCILIATION.md` says to treat the shipped HTML's macro-color pattern as a known inconsistency, not a new decision — we should confirm that still holds.
7. **Native app on the horizon?** If Android/iOS is likely, Health Connect (§3.2) and push (§3.1) strategy should be decided together.

---

## 10. Appendix — commands used & raw results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint` | 3 errors (`scripts/generate-icons.js`, `no-require-imports`), 1 warning (`layout.tsx` custom font link) |
| `npm audit --omit=dev` | 3 vulns: `next` (critical, fix → 16.4.3), `sharp` (high), `source-map-js` (high) |
| Backend tests | **not run** (live Supabase) |
| e2e | **not run** (live Gemini + backend) |
| Repo size | 198 tracked files, 32 commits, ~10.7k lines of app source |
