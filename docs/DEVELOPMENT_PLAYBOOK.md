# MacroMate — Phase-wise Development Playbook (v2.1: speed, calendar, redesign)

> **v2.1 (2026-10-27):** updated with the owner's answers (section B), the design references (section D) and the single-branch workflow (rule C1). Nothing is implemented yet.

Companion to `docs/UPGRADE_PLAYBOOK.md` (the audit). That file says *what is wrong*; this one says *what to build, in what order, and how to prove each step*.

**Repo:** https://github.com/shailkamtikar/macromate.git · **Frontend:** https://macromate-two.vercel.app (Vercel) · **Backend:** https://macromate-vf5z.onrender.com (Render) · **DB/Auth:** Supabase · **AI:** Gemini

---

## A. Your three goals, mapped to phases

| Goal (from you / your boss) | Phase |
|---|---|
| **1. Fix the slow dashboard** — boss: *"separate the AI API call and the backend data API call; 'What to eat next' is the cause"* | **Phase 1** (+ Phase 4 for the deeper fix) |
| **2. Calendar** — click any date, see everything the dashboard shows (macros, water, diary…) for that date | **Phase 2** |
| **3. Full UI redesign** — same green/white + dark/light, motion.dev animations, fast, "feels like your own" | **Phase 5 + 6** |
| Trust/security holes found in the audit (they affect the redesign's data flow, so they come before it) | Phase 3 |

### What the code says about the boss's diagnosis *(verified)*
- He is **right that "What to eat next" is why Today is slow**: `today/page.tsx` `loadDay()` does `Promise.all([foodLogs, water, glassSizes, fetchSuggestions()])` and only calls `setFoodLogs(...)` after **all four** return. The slowest call (suggestions) holds the whole page hostage.
- One correction to make before we build: **`/api/suggestions` does not call Gemini.** It is deterministic but heavy (≈5 sequential DB round-trips, each on a **fresh TLS connection** because `SupabaseAdmin` uses `httpx.request` per call, plus a 300-row join). So "separate AI from data" is the right architecture (and Coach/Calculate/Diet *do* use Gemini and must never block the dashboard), but the real fixes are: **(a) stop one slow call blocking the page, (b) make suggestions cheap, (c) keep AI endpoints isolated.** Phase 1 does all three.
- Likely multiplier: **Render free tier sleeps after ~15 min idle → 30–60 s cold start.** That alone can look like "slow site". Milestone 1.4 handles it.

---

## B. Confirmed decisions (owner's answers)

| # | Topic | Decision |
|---|---|---|
| 1 | Hosting | Vercel (frontend), Render **Free** (backend), Supabase — all **Asia-Pacific**. UptimeRobot already pings Render, so it does **not** idle → cold starts are *not* the cause of slowness. |
| 2 | Deploy | Pushing to GitHub does **not** auto-deploy; the owner redeploys manually after approving a locally-tested build. |
| 3 | Git workflow | **One branch `macromate-upgrades`**, pushed to GitHub with all existing files + upgrades, one commit per milestone. `main` is never touched; the owner merges/redeploys later. |
| 4 | Testing | Everything tested **locally first**, against a separate **Supabase TEST project** created by the owner (free). Email confirmation is **off** in the test project only. |
| 5 | Food data | Production `food_items` is copied **read-only** into the test project (milestone 0.5). Production is never written to. |
| 6 | Production DB | Migrations (+ rollback SQL) are **prepared and tested, then applied by the owner** to production when redeploying. I never run them on production. |
| 7 | Users / timeline | 3 real users (owner + 2). Boss wants it done in ~2–3 days. **Everything in this playbook is in scope.** |
| 8 | Calendar | Past dates: view **and add/edit/delete** food and water. Future dates: blocked. Past days show the **targets that were active that day** (history snapshot, milestone 2.1). |
| 9 | Notifications | **No push.** Keep the existing in-app banner / OS notification shown while the app is open (e.g. "someone added Breakfast"). |
| 10 | Landing page | **Yes**, at `/` for logged-out visitors (milestone 6.6, required). |
| 11 | Design | Complete redesign, "more futuristic and user-friendly", **dark by default**, light available, green accent. Stitch is **dropped**; the references in section D drive the design. The sidebar concept stays but is restyled. |
| 12 | Loader | The current `BootstrapLoader` is replaced by skeleton placeholders everywhere (1.1, 5.3). |
| 13 | AI | Gemini **free tier**; 3.6 Flash → 3.5 Flash-Lite fallback stays. Quotas are tuned to Gemini's per-minute limits (3.3). |
| 14 | Out of scope | Push notifications, AI **photo** logging, native apps, barcode scanning, Health Connect/HealthKit. |
| 15 | Automation limits | I only work inside the MacroMate folder; I may commit/push to `macromate-upgrades`; I never touch Vercel/Render settings or the production database. |

---

## B2. Delivery order for a 2–3 day window

| Day | Focus | Milestones |
|---|---|---|
| 1 | Safety, test env, **speed**, **calendar** backend + UI | 0.1–0.5, 1.1–1.4, 2.1–2.4 |
| 2 | Design system + dashboard/landing (what the boss will see first) | 5.1–5.4, 6.1, 6.6, 6.2 |
| 3 | Remaining pages, security, data layer, release | 6.3–6.5, 3.1–3.3, 4.1–4.2, 7.1, 8.1–8.2 |

Phase numbers stay as written (dependencies are by milestone, not by day); this table only says what to do first if time runs short. If something must slip, slip **4.2** and the optional load test in **8.1** — never the security milestones before release.

---

## D. Design references (owner-supplied)

**Principles borrowed (not copied):**
- *Rack Explorer* (siemens-rack-3d.vercel.app): dark-default editorial landing; tight serif-style headline with **one italic accent phrase**; mono uppercase eyebrow label; hairline rules; numbered sections ("01 / 02 / 03"); figure captions ("FIG. 1"); the **real product as the hero** (interactive, draggable); a call-to-action card with corner brackets and an arrow; Light/Dark toggle in the nav.
- *Calorie-app screenshots:* a large calorie figure ("1,728 / 2,200") over a thick progress bar; three macro stats and ring gauges; a **week dot-grid** (Kcal/Fat/Carbs/Protein dots, "Too high / OK / Too low" band, selected day outlined) — reused as the calendar week view; streak flame with day dots; weight chart with tooltip; insight cards with status chips (Low / Optimal); a floating dark **"Add meal"** pill; bottom tab bar on mobile; a dark chat screen with food cards.
- **Palette:** green accent (existing `--color-primary` family), near-black dark ground (default), warm off-white light mode. Macro colors stay semantic (protein/carbs/fat/water).
- **Motion:** counts that tick up, bars/rings that fill, staggered card entrances, sliding selection highlight on the calendar, soft route transitions, magnetic/press feedback on buttons; always `prefers-reduced-motion`-aware. Reference libraries for ideas: motion.dev, React Bits, 21st.dev (check each snippet's license before copying code).

---

## C. Global rules for every milestone

1. **Branching:** everything happens on **one branch, `macromate-upgrades`** (created in 0.1 from `main`), **one commit per milestone**, pushed to `origin macromate-upgrades` after the milestone passes. `main` is never touched; the owner merges and redeploys manually when satisfied. Each phase ends with a **tag** (`phase-N-done`) on this branch so there is a named rollback point per phase.
2. **Never commit:** `.env`, `backend/.env`, `frontend/.env.local`, `.codex/`, `.claude/settings.local.json`, `backend/.env.*` (except `.env.example`), `frontend/.env*.local`, API keys (Supabase service-role, Gemini, Stitch, Firebase), `node_modules/`, `.next/`, `test-results/`, `playwright-report/`, `backend/.venv/`, `__pycache__/`, `*.tsbuildinfo`, personal screenshots. Check with `git status` and `git diff --cached --name-only` before every commit.
3. **Commit authorship:** commits must be authored only by you. Set once: `git config user.name "Shail Kamtikar"` and `git config user.email "shailkamtikar@gmail.com"`. **Do not add `Co-Authored-By:` or "Generated with" trailers.** Every Git Checkpoint below ends with a command that fails if a trailer sneaks in.
4. **Definition of green** (must pass before any commit):
   ```bash
   cd frontend && npx tsc --noEmit && npx eslint && npm run build
   cd ../backend && uv run pytest -m "not live"      # "live" marker is created in 0.3
   ```
5. **Performance budget** (set in 0.4, enforced after): Today shows the diary within **1.5 s** on a warm backend over simulated Fast 4G; backend p95 for any non-AI endpoint **< 500 ms warm**; JS shipped on `/today` must not grow by more than **+40 KB gzip** versus baseline even after the redesign.
6. **Test Status column:** `☐` not run, `✔` pass, `✘` fail. A milestone is DONE only when every row is `✔`.
7. **Dependencies are explicit** ("Requires: x.y"). Do not start a milestone before its requirements are DONE.
8. **Live-service caution:** from 0.5 onward `backend/.env` and `frontend/.env.local` point to the **TEST Supabase project**. Production keys live only in `backend/.env.prod` (gitignored, used solely for the read-only food export). Never run `pytest`, e2e or migrations with production keys.

---

# PHASE 0 — Project Setup & Baseline

## Milestone 0.1 — Safe workflow: baseline tag, branch, identity
**1. Milestone Name:** Establish a rollback point and branching workflow.
**2. Objective:** Freeze the currently-deployed, working version as a named tag so any later problem can return to it in one command.
**3. Tasks to Complete**
- [ ] `git status` is clean except `.codex/` (handled in 0.2).
- [ ] Set git identity (rule C3).
- [ ] Tag current `main` as `baseline-2026-10-27`.
- [ ] Create branch `macromate-upgrades`.
- [ ] Note the current Vercel and Render deployment IDs/URLs in `docs/DEPLOY_NOTES.md` (so dashboard "rollback" targets are known).
**4. Files / Modules Affected:** `docs/DEPLOY_NOTES.md` (new). No code.
**5. Implementation Guidance:** Tags are cheap and never move. Keep `main` deployable; don't commit directly to it from now on. Find deployment IDs in Vercel → Deployments and Render → Events.
**6. Test Cases**

| ID | Scenario | Preconditions | Steps | Expected | Status |
|---|---|---|---|---|---|
| T0.1-1 | Tag exists and points at deployed commit | Vercel shows production commit hash | `git rev-parse baseline-2026-10-27` and compare to Vercel's hash | Hashes match | ☐ |
| T0.1-2 | Identity correct | Config set | `git config user.name; git config user.email` | Your name/email | ☐ |
| T0.1-3 (neg.) | Direct push to main avoided | On `macromate-upgrades` | `git branch --show-current` | Not `main` | ☐ |
| T0.1-4 | Restore works | Tag pushed | `git worktree add ../mm-baseline baseline-2026-10-27 && cd ../mm-baseline && git log -1` | Opens the baseline commit | ☐ |

**7. Verification Checklist:** [ ] tag visible on GitHub Releases/Tags · [ ] `DEPLOY_NOTES.md` lists both deployment IDs · [ ] production site still loads.
**8. Completion Criteria:** Tag pushed, branch created, notes committed.
**9. Git Checkpoint**
```bash
git tag baseline-2026-10-27 && git push origin baseline-2026-10-27
git switch -c macromate-upgrades
git status
git add docs/DEPLOY_NOTES.md
git commit -m "docs: record baseline deployment IDs"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
Do **not** commit: `.codex/`, `.env`.
**10. Rollback / Recovery:** Docs-only; `git revert <hash>`. To restore the whole app later: `git switch -c restore baseline-2026-10-27` and redeploy, or use Vercel/Render's "redeploy previous deployment".

---

## Milestone 0.2 — Secret hygiene
**Requires:** 0.1
**1. Name:** Stop secrets from leaking.
**2. Objective:** Make it impossible to accidentally commit `.codex/` (contains a plaintext Stitch key) or any `.env.*` file, and remove the unused Stitch key.
**3. Tasks**
- [ ] Add `.codex/`, `.claude/settings.local.json`, `frontend/test-results/`, `frontend/playwright-report/`, `*.tsbuildinfo` to `.gitignore`.
- [ ] Stitch is **no longer used**: delete `.codex/` locally and the `STITCH_API_KEY` lines from root `.env`. Revoking the key in your Stitch account is optional (it was only stored locally and in an AI chat transcript, never in git).
- [ ] Confirm Render & Vercel env vars exist and none are committed (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CORS_ALLOW_ORIGINS`, `NEXT_PUBLIC_*`).
- [ ] Scan history for leaked keys: `git log -p | grep -iE "AIza|service_role|sb_secret|AQ\.Ab"`.
**4. Files:** `.gitignore`, `.codex/config.toml` (local), Render/Vercel dashboards.
**5. Guidance:** `NEXT_PUBLIC_*` values are public by design (anon key only). If the history scan finds a real key, **rotate it** — don't try to rewrite history.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T0.2-1 | `.codex` ignored | Edit done | `git status --short` | `.codex/` not listed | ☐ |
| T0.2-2 | No secrets tracked | — | `git grep -nE "AIza\|service_role\|AQ\.Ab"` | No real keys | ☐ |
| T0.2-3 | History scan | — | command above | Empty (or keys rotated) | ☐ |
| T0.2-4 | Stitch config removed | — | check root `.env` and `.codex/` | no Stitch key left in the working tree | ☐ |
| T0.2-5 | App unaffected | — | Open prod site, log in | Works | ☐ |

**7. Verification:** [ ] `git check-ignore -v .codex/config.toml` prints a rule · [ ] no Stitch key remains in the working tree.
**8. Done when:** all tests ✔ and the local Stitch key is removed.
**9. Git Checkpoint**
```bash
git status
git add .gitignore
git commit -m "chore: ignore local tool configs and test artifacts"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>` (only .gitignore changed). Deleting local files is not tracked by git; nothing else to recover.

---

## Milestone 0.3 — Toolchain green + CI + dependency security
**Requires:** 0.2
**1. Name:** Lint/typecheck/build pass; Next.js security bump; CI.
**2. Objective:** A trustworthy "green" signal, and removal of the critical `next` advisories.
**3. Tasks**
- [ ] Rename `frontend/scripts/generate-icons.js` → `.cjs` (fixes 3 ESLint `no-require-imports` errors); update any script reference.
- [ ] `cd frontend && npm i next@^16.4.3 eslint-config-next@^16.4.3 && npm audit fix`.
- [ ] Confirm `agentRules: false` in `next.config.ts` is still a valid option (else remove it).
- [ ] Add `live` pytest marker; mark tests that need Supabase/Gemini (`test_rls.py`, `*_api.py`, `test_gemini.py`) with `@pytest.mark.live`; register in `backend/pyproject.toml` (`[tool.pytest.ini_options] markers = ["live: needs real Supabase/Gemini"]`).
- [ ] Add `.github/workflows/ci.yml`: Node 20 → `npm ci`, `tsc`, `eslint`, `next build`; Python 3.12 + uv → `uv run pytest -m "not live"`.
- [ ] Fail the production build when `NEXT_PUBLIC_API_URL` is unset (`frontend/src/lib/api.ts`: throw if `process.env.NODE_ENV==="production"` and fallback would be used).
**4. Files:** `frontend/package.json`, `package-lock.json`, `frontend/next.config.ts`, `frontend/scripts/generate-icons.cjs`, `backend/pyproject.toml`, `backend/tests/*`, `.github/workflows/ci.yml`, `frontend/src/lib/api.ts`.
**5. Guidance:** Why CI: without it "green" is only your laptop. Why a `live` marker: current tests mutate the real Supabase project; CI must not. Pin by lockfile (`npm ci`, `uv sync --frozen`).
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T0.3-1 | Typecheck | deps installed | `npx tsc --noEmit` | exit 0 | ☐ |
| T0.3-2 | Lint | — | `npx eslint` | 0 errors | ☐ |
| T0.3-3 | Audit | — | `npm audit --omit=dev` | no critical/high | ☐ |
| T0.3-4 | Build | `.env.local` set | `npm run build` | success | ☐ |
| T0.3-5 (neg.) | Missing API URL | unset var, `NODE_ENV=production` | `npm run build` | build/boot fails with clear message | ☐ |
| T0.3-6 | Non-live tests | — | `uv run pytest -m "not live"` | pass, no network | ☐ |
| T0.3-7 | CI | pushed | open GitHub Actions run | all jobs green | ☐ |
| T0.3-8 (regress.) | App smoke | `npm run dev` + backend | login → Today → add food | works as before | ☐ |

**7. Verification:** [ ] Vercel preview of `macromate-upgrades` loads and logs in · [ ] CI badge green.
**8. Done when:** T0.3-* ✔, audit clean.
**9. Git Checkpoint**
```bash
git status
git add frontend/package.json frontend/package-lock.json frontend/next.config.ts frontend/scripts frontend/src/lib/api.ts backend/pyproject.toml backend/tests .github
git commit -m "chore: upgrade next, fix lint, add CI and live-test marker"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`; if only the Next bump misbehaves: `git revert` and `npm ci`. Vercel preview deployments are disposable.

---

## Milestone 0.4 — Performance baseline (numbers before changes)
**Requires:** 0.5
**1. Name:** Measure before optimizing.
**2. Objective:** Record real timings so every later claim of "faster" is provable.
**3. Tasks**
- [ ] Time each endpoint warm and cold (Render asleep): `curl -s -o /dev/null -w "%{time_starttransfer} %{time_total}\n" -H "Authorization: Bearer $TOKEN" https://macromate-vf5z.onrender.com/api/suggestions` for `/api/food-logs?date=`, `/api/water-logs`, `/api/glass-sizes`, `/api/suggestions`, `/api/achievements`, `/api/notification-settings/check-now`, `/api/friends/leaderboard`. Get `$TOKEN` from the browser (DevTools → Application → local storage → Supabase session).
- [ ] Record Chrome DevTools Performance (Fast 4G, 4× CPU slowdown): time to diary visible, LCP, total requests, JS KB on `/today`.
- [ ] Run Lighthouse (mobile) on `/login` and `/today`.
- [ ] Save a table to `docs/PERF_BASELINE.md`.
**4. Files:** `docs/PERF_BASELINE.md`.
**5. Guidance:** Take 5 runs, report median and worst. Run local timings against the TEST stack with seeded user A (≥30 days of logs). Production numbers, if wanted, are read-only GETs with your own token. Cold start = wait 20 min idle, then first request.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T0.4-1 | Warm timings captured | token | run curl ×5 per endpoint | median table filled | ☐ |
| T0.4-2 | Cold timing captured | idle ≥20 min | first request | value recorded | ☐ |
| T0.4-3 | Waterfall identifies blocker | DevTools | load `/today` | suggestions request is the longest (confirms boss's claim) or the true slowest is named | ☐ |
| T0.4-4 | Lighthouse | — | run | scores saved | ☐ |

**7. Verification:** [ ] numbers reproducible within ±20 % on a second day.
**8. Done when:** `PERF_BASELINE.md` committed with budgets copied from rule C5.
**9. Git Checkpoint**
```bash
git status
git add docs/PERF_BASELINE.md
git commit -m "docs: record performance baseline"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
Do not commit raw tokens/HAR files (they contain your JWT).
**10. Rollback:** docs only → `git revert <hash>`.

## Milestone 0.5 — Local TEST environment (separate Supabase project)
**Requires:** 0.3
**1. Name:** A safe test project so nothing runs against production.
**2. Objective:** Local frontend + backend + tests run against a free **test Supabase project** with the same schema and a copy of the food database; production is never written to.
**3. Tasks to Complete**
- [ ] **Owner:** create a free Supabase project (Asia-Pacific), e.g. `macromate-test`. In Auth → Providers → Email turn **Confirm email OFF** (test project only). Provide its URL, anon key and service-role key.
- [ ] Move existing `backend/.env` → `backend/.env.prod` (gitignored). Create a new `backend/.env` with the **test** URL/keys, the same `GEMINI_API_KEY`, and `CORS_ALLOW_ORIGINS=["http://localhost:3000"]`.
- [ ] Create `frontend/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:8000` and the **test** URL + anon key.
- [ ] `.gitignore`: add `backend/.env.*`, `!backend/.env.example`, `frontend/.env*.local`.
- [ ] Link and push the schema to the test project: `cd backend && npx supabase link --project-ref <test-ref>` then `npx supabase db push` (applies the 20 existing migrations).
- [ ] **Read-only** copy of `food_items` from production: `backend/scripts/copy_foods.py` does `GET` on production (keys from `.env.prod`) and upserts into the test project (keys from `.env`). Exclude `is_ai_estimate = true` rows and set `created_by = null` (those user ids don't exist in the test project).
- [ ] Create test accounts A, B, C via the signup page; make A and B friends. Seed ~35 days of logs for A with `backend/scripts/seed_test_user.py` (needed for realistic timings and calendar tests).
**4. Files / Modules Affected:** `.gitignore`, `backend/.env` (local), `backend/.env.prod` (local), `frontend/.env.local` (local), `backend/scripts/copy_foods.py`, `backend/scripts/seed_test_user.py`, `docs/DEPLOY_NOTES.md` (how to switch env).
**5. Implementation Guidance:** Why a separate project: the current backend tests create and delete real users and rows; with 3 live users that must never hit production. The copy script must contain no production write calls — check with `grep -nE "post|patch|delete|insert|upsert" backend/scripts/copy_foods.py` (writes may only reference the test client). Never commit any `.env*`.
**6. Test Cases**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T0.5-1 | Schema parity | test project linked | list `public` tables and RLS flags on both projects | same tables and RLS enabled | ☐ |
| T0.5-2 | Food copy | script run | `select count(*) from food_items` on test vs prod | equal (minus AI-estimate rows) | ☐ |
| T0.5-3 (sec.) | Prod untouched | — | row counts of every prod table before/after the script | unchanged | ☐ |
| T0.5-4 | App on test stack | both servers up | signup A → onboarding → log food | works with no email step | ☐ |
| T0.5-5 | Non-live tests unaffected | — | `uv run pytest -m "not live"` | pass | ☐ |
| T0.5-6 | Live tests on TEST only | `.env` = test | `uv run pytest -m live` | pass; prod unchanged | ☐ |
| T0.5-7 (neg.) | No secrets staged | — | `git diff --cached --name-only` | no `.env*` listed | ☐ |

**7. Verification Checklist:** [ ] the **production** Supabase dashboard shows no new rows or users from testing.
**8. Milestone Completion Criteria:** all tests ✔, user A has 35 days of data, `DEPLOY_NOTES.md` explains env switching.
**9. Git Checkpoint**
```bash
git status
git add .gitignore backend/scripts docs/DEPLOY_NOTES.md
git commit -m "chore: test environment, food copy and seed scripts"
git diff --cached --name-only | grep -E "\.env" && echo "STOP: env file staged" || echo "no env files staged"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback / Recovery:** `git revert <hash>`. The test project is disposable (delete it in the Supabase dashboard); rename `backend/.env.prod` back to `.env` to return to the old setup.

### ▶ Phase 0 Completion Checkpoint
| Item | Value |
|---|---|
| Completed milestones | 0.1 0.2 0.3 0.4 0.5 |
| Tests passed | all `T0.*` ✔ (fill) |
| Known issues | (fill) |
| Git commit/hash | `git rev-parse --short HEAD` → ____ |
| Overall verification | CI green; preview works; baseline recorded |
| **Go/No-Go for Phase 1** | Go only if CI green and baseline file exists |
```bash
git tag phase-0-done && git push origin phase-0-done
```

---

# PHASE 1 — Dashboard speed (your boss's fix)

## Milestone 1.1 — Progressive dashboard loading
**Requires:** Phase 0
**1. Name:** One slow call must never block the dashboard.
**2. Objective:** Diary, totals and water appear as soon as *their* data arrives; "What to eat next" loads afterwards on its own with a skeleton.
**3. Tasks**
- [ ] In `today/page.tsx` replace the single `Promise.all` in `loadDay()` with independent fetches: food logs, water, glass sizes start together and each calls its own setter on success.
- [ ] Fetch suggestions **separately, after** the three above resolve (or on `requestIdleCallback`/next tick), with its own `suggestionsLoading` / `suggestionsError` state.
- [ ] Render a skeleton card where suggestions will appear; on failure show "Couldn't load suggestions — Retry" (never blank the page).
- [ ] Defer `fetchAchievements()` until the diary has rendered.
- [ ] Keep `mutationVersion` guard semantics for each independent fetch.
- [ ] Replace the do-nothing `BootstrapLoader` on `/today` with page-shaped **skeleton placeholders** (new minimal `components/Skeleton.tsx`: shimmer blocks for the energy card, three meal cards, water card, suggestions card) shown immediately, before the first response.
- [ ] Defer `NotificationPoller`'s first poll by ~10 s (don't compete with first paint).
**4. Files:** `frontend/src/app/today/page.tsx`, `frontend/src/components/NotificationPoller.tsx`, new `frontend/src/components/SuggestionsCard.tsx` (extract the JSX).
**5. Guidance:** No new library. Use independent `async` functions, not one `Promise.all`. Keep all existing `data-testid`s (`diary`, `consumed-calories`, `suggestions-card`, `suggestions-message`, `water-total`) because 21 e2e specs depend on them. Do **not** show stale data as fresh: skeleton until first success.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T1.1-1 | Diary before suggestions | DevTools: throttle only `/api/suggestions` (block/delay 8 s) | load `/today` | Diary + water visible < 1.5 s; suggestions shows skeleton | ☐ |
| T1.1-2 (fail) | Suggestions 500 | block `/api/suggestions` | load | Diary fine; suggestion card shows retry; no page-level error | ☐ |
| T1.1-3 | Retry | after T1.1-2, unblock | click Retry | suggestions appear | ☐ |
| T1.1-4 (edge) | Mutate while loading | delay food-logs 3 s | add food from picker during load | optimistic row stays, not overwritten by stale fetch | ☐ |
| T1.1-5 (regress.) | Existing flows | — | run `e2e/core-journey`, `optimistic-updates`, `suggestions`, `food-log-editing` | pass | ☐ |
| T1.1-6 (perf) | Budget | Fast 4G throttle | measure time to diary visible | ≤ baseline − (suggestions time) and ≤1.5 s warm | ☐ |

**7. Verification:** [ ] Network tab shows 3 requests start together and the 4th starts after · [ ] no layout jump when suggestions arrive (reserved height).
**8. Done when:** T1.1-* ✔ and perf recorded in `PERF_BASELINE.md`.
**9. Git Checkpoint**
```bash
git status
git add frontend/src/app/today frontend/src/components/SuggestionsCard.tsx frontend/src/components/NotificationPoller.tsx
git commit -m "perf(today): load diary independently of suggestions"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash> && git push origin macromate-upgrades`. Production is untouched until you merge and redeploy.

---

## Milestone 1.2 — Separate AI API layer from data API layer
**Requires:** 1.1
**1. Name:** Isolate AI calls from data calls (the boss's explicit ask).
**2. Objective:** AI (Gemini) endpoints and plain-data endpoints are separate in the client, in timeouts/failure handling, and in the backend so slow AI can never starve data requests.
**3. Tasks**
- [ ] Split `frontend/src/lib/api.ts` (668 lines) into `lib/api/http.ts` (shared `authFetch`), `lib/api/data.ts` (food, water, profile, progress, friends, achievements, suggestions, activity, notifications) and `lib/api/ai.ts` (`calculateFoodsWithAi`, `generateDiet`, `fetchCoachHistory`, `sendCoachMessage`). Keep a barrel `lib/api/index.ts` re-exporting everything so imports don't break.
- [ ] `ai.ts` uses `AbortController` with a 35 s timeout and a distinct error code; `data.ts` uses 10 s.
- [ ] Backend: confirm every Gemini route lives under `/api/ai/*` (coach, calculate-foods, generate-diet ✔ today). Add a middleware tagging request class (`ai` vs `data`) in logs with duration.
- [ ] Backend: add a bounded semaphore (e.g. 4 concurrent Gemini calls) in `core/gemini.py` so a burst of AI requests returns 429/503 quickly instead of exhausting the worker thread pool.
- [ ] Add `GET /health/deep` (Supabase reachable; Gemini key present; does **not** call Gemini).
**4. Files:** `frontend/src/lib/api/*` (new), `frontend/src/lib/api.ts` (becomes re-export), `backend/app/core/gemini.py`, `backend/app/main.py`, `backend/tests/test_gemini*.py`.
**5. Guidance:** *Why a semaphore:* handlers are sync `def` running on FastAPI's ~40-thread pool; each Gemini call holds a thread up to 28 s. Capping AI concurrency preserves threads for data endpoints. Full async migration is deferred to 4.2 if measurements demand it. Do not move AI to a second Render service yet (extra cost/cold start); revisit if 4.2 shows contention.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T1.2-1 | Imports intact | — | `tsc --noEmit` | exit 0 | ☐ |
| T1.2-2 | Data stays fast during AI load | backend running | fire 10 parallel `POST /api/ai/coach/message`, meanwhile `GET /api/food-logs` ×20 | data p95 < 500 ms | ☐ |
| T1.2-3 (fail) | AI timeout | mock Gemini hang (monkeypatch) | send coach message | UI shows friendly "taking too long" after timeout; Today unaffected | ☐ |
| T1.2-4 (edge) | Semaphore full | 5th concurrent AI call | request | fast 429/503 with calm message | ☐ |
| T1.2-5 | Deep health | — | `curl /health/deep` | `{supabase:"ok", gemini_key:"present"}` | ☐ |
| T1.2-6 (AI valid.) | Output validation unchanged | — | `uv run pytest backend/tests/test_coach_intent.py backend/tests/test_ai_food_parser.py` | pass | ☐ |
| T1.2-7 (regress.) | e2e AI specs | — | `e2e/ai-features`, `coach-input` | pass | ☐ |

**7. Verification:** [ ] backend logs show `class=ai`/`class=data` with durations · [ ] Coach slow ≠ Today slow.
**8. Done when:** T1.2-* ✔.
**9. Git Checkpoint**
```bash
git status
git add frontend/src/lib backend/app backend/tests
git commit -m "perf: separate AI and data API layers, cap AI concurrency"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`; barrel re-export means partial revert is safe.

---

## Milestone 1.3 — Make `/api/suggestions` (and every DB call) cheap
**Requires:** 1.2
**1. Name:** Shared HTTP client + fewer queries for suggestions.
**2. Objective:** Remove the per-call TLS handshake and cut suggestions to ≤2 DB round-trips.
**3. Tasks**
- [ ] `core/supabase_admin.py`: one module-level `httpx.Client(base_url=…, headers=…, limits=httpx.Limits(max_keepalive_connections=20), http2=True, timeout=15)`; `SupabaseAdmin` uses it instead of `httpx.request`. Add `httpx[http2]` (`h2`) dependency.
- [ ] Combine today's consumed totals into one RPC `daily_totals(user_id, from, to)` (SQL `sum`) instead of fetching all rows (new migration `…_daily_totals_rpc.sql`).
- [ ] Replace `_personal_history_candidates`' 300-row join with an RPC returning the 15 most-recent distinct foods (`distinct on (food_item_id)`).
- [ ] Add a 30–60 s per-user in-memory TTL cache (`cachetools.TTLCache`) of the suggestions result, invalidated on food-log create/update/delete for that user.
- [ ] Index: `create index if not exists food_logs_user_food_idx on food_logs (user_id, food_item_id, logged_at desc);`
**4. Files:** `backend/app/core/supabase_admin.py`, `backend/app/routers/suggestions.py`, `backend/app/routers/food.py` (invalidate cache), `backend/supabase/migrations/<ts>_daily_totals_and_recent_foods_rpc.sql`, `backend/supabase/rollbacks/<ts>_…down.sql`, `backend/pyproject.toml`, `backend/tests/test_suggestions_api.py`.
**5. Guidance:** Keep ranking logic in `domain/suggestions.py` untouched (it's tested). RPCs are `security invoker`, `stable`, granted to `service_role`. Cache is per Render instance (fine on one instance; document that). Migration filenames need a **unique timestamp** (see `docs/DATABASE.md`). Apply to a non-prod Supabase project first.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T1.3-1 | Same output | seeded user | compare `/api/suggestions` before/after (same data) | same suggestion ids & ordering | ☐ |
| T1.3-2 | Latency | warm | 5× curl | median < 300 ms (baseline in 0.4) | ☐ |
| T1.3-3 | Cache invalidation | cached result | add food via API, call suggestions | remaining calories updated immediately | ☐ |
| T1.3-4 (sec.) | User isolation | users A,B | A's cached result requested as B | B gets B's data (cache key = user id) | ☐ |
| T1.3-5 (edge) | New user, no logs | fresh account | call | 200 with global pool, no 500 | ☐ |
| T1.3-6 (fail) | RPC error | simulate 500 | call | 502/500 handled; Today still renders (1.1) | ☐ |
| T1.3-7 (schema) | Migration | non-prod project | `npx supabase db push`; `select * from daily_totals(...)` | returns sums matching Python | ☐ |
| T1.3-8 (regress.) | Existing backend tests | — | `uv run pytest backend/tests/test_suggestions_*.py backend/tests/test_food_api.py` | pass | ☐ |

**7. Verification:** [ ] `DATABASE.md` lists the new RPCs · [ ] down-migration tested on non-prod.
**8. Done when:** T1.3-* ✔ and latency recorded.
**9. Git Checkpoint**
```bash
git status
git add backend/app backend/supabase backend/pyproject.toml backend/uv.lock backend/tests docs/DATABASE.md
git commit -m "perf(backend): shared keep-alive client, SQL totals, cached suggestions"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
Do not commit `backend/.env`.
**10. Rollback:** `git revert <hash>`; DB: run the `rollbacks/…down.sql` (drops the RPCs/index — additive, safe). Render: Dashboard → Deploys → previous deploy → Rollback.

---

## Milestone 1.4 — Confirm backend stays warm; friendly slow-start state
**Requires:** 1.3
**1. Name:** Verify keep-warm and handle slow first responses.
**2. Objective:** UptimeRobot already pings Render, so cold starts should not occur; prove it, and make any slow response (Render free instance waking after a deploy/restart) look intentional.
**3. Tasks to Complete**
- [ ] Check UptimeRobot: the monitor URL is `https://macromate-vf5z.onrender.com/health`, interval ≤ 10 min (Render free sleeps after ~15 min), and recent history shows no gaps.
- [ ] Measure first-request time after ≥30 min without using the app; record in `docs/PERF_BASELINE.md`.
- [ ] Frontend: on app load fire a fire-and-forget `fetch(API_URL + "/health")` (layout-level effect) so any wake-up starts immediately.
- [ ] If the first data request takes > 3 s, show a calm inline "Waking the server…" state inside the skeleton (not a blocking screen).
**4. Files / Modules Affected:** `frontend/src/app/layout.tsx` or a small `components/WarmPing.tsx`, `components/Skeleton.tsx`, `docs/PERF_BASELINE.md`.
**5. Implementation Guidance:** Don't ping from the Service Worker (cross-origin). Do not add a second monitor. If measurements show the monitor is working, this milestone is mostly verification.
**6. Test Cases**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T1.4-1 | Idle then load | wait ≥30 min | open site | diary appears within budget, no long hang | ☐ |
| T1.4-2 | Slow first call | throttle `/api/*` to 5 s | load | "Waking the server…" appears, then content | ☐ |
| T1.4-3 (fail) | Backend down | stop service | load | friendly error + Retry, no blank page | ☐ |
| T1.4-4 | Monitor history | — | check UptimeRobot 7 days | no gaps > 10 min | ☐ |

**7. Verification Checklist:** [ ] cold/idle timing recorded.
**8. Milestone Completion Criteria:** T1.4-* ✔.
**9. Git Checkpoint**
```bash
git status
git add frontend/src docs/PERF_BASELINE.md
git commit -m "perf: warm ping and slow-start state"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback / Recovery:** `git revert <hash>`.

### ▶ Phase 1 Completion Checkpoint
| Item | Value |
|---|---|
| Completed milestones | 1.1 1.2 1.3 1.4 |
| Tests passed | `T1.*` + full e2e (`npx playwright test`) against a **non-prod** stack |
| Known issues | (fill) |
| Git commit/hash | ____ |
| Overall verification | Today diary ≤1.5 s warm; suggestions off the critical path; AI isolated; no cold start after idle |
| **Go/No-Go for Phase 2** | Go if budget met and e2e green |
```bash
git tag phase-1-done && git push origin phase-1-done
```

---

# PHASE 2 — Calendar (view any day's dashboard)

## Milestone 2.1 — Day & month summary APIs
**Requires:** Phase 1
**1. Name:** Backend endpoints for "any date".
**2. Objective:** One request returns everything the dashboard shows for a date; one request returns a month's dots for the calendar.
**3. Tasks**
- [ ] `GET /api/days/{date}` → `{date, targets, consumed, meals:[food logs], water:{total_ml, logs}, glass_sizes, activity, weight_kg|null, goal_hit:{calories, protein, carbs, fat}}` using profile timezone and the existing `day_bounds_utc`.
- [ ] `GET /api/days/summary?start=YYYY-MM-DD&end=YYYY-MM-DD` (max 62 days) → per-date `{logged: bool, calories, protein_g, water_ml, calorie_goal_hit}`.
- [ ] Reject future dates beyond today+1 with 422; invalid formats 422.
- [ ] Suggestions & achievements are **not** part of this payload (today-only; stay separate calls).
- [ ] **Target history:** new table `daily_targets(user_id, effective_from date, target_calories, target_protein_g, target_carbs_g, target_fat_g, water_goal_ml, primary key (user_id, effective_from))` with RLS (owner read-only; writes by trigger/service role). A `security definer` trigger on `profiles` (after insert or update of the target columns) upserts a row with `effective_from = current local date`. Backfill: one row per existing user with `effective_from = profile.created_at::date` using their **current** targets (no earlier history exists). `GET /api/days/{date}` returns the targets from the latest `effective_from <= date`.
**4. Files:** new `backend/app/routers/days.py`, `backend/app/domain/day_summary.py` (pure functions, reuse `progress.group_food_logs_by_day`), `backend/app/main.py` (include router), `backend/tests/test_days_api.py`, `test_day_summary.py`, migration `<ts>_daily_targets.sql` (+ `rollbacks/…down.sql`); `frontend/src/lib/api/data.ts` types.
**5. Guidance:** Reuse, don't re-implement, bucketing (`timeutil`). Use the SQL totals RPC from 1.3 for month summary (one query, not 31). Past-day targets come from `daily_targets` (decision B8); days before the first snapshot show the earliest snapshot, which for pre-existing users is their current targets — say so once in the UI ("Targets before Oct 2026 are approximate"). The trigger works regardless of whether the browser or the API writes the profile, so Phase 3's `/api/profile` needs no extra snapshot code. Use a timezone-aware local date in the trigger via the profile's `timezone`.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T2.1-1 | Day with data | user has logs on D | `GET /api/days/D` | meals, water, totals equal sum of `/food-logs?date=D` | ☐ |
| T2.1-2 | Empty day | no logs | GET | zeros, empty arrays, 200 | ☐ |
| T2.1-3 (tz) | Timezone boundary | profile tz Asia/Kolkata, log at 23:50 IST | GET that date | belongs to that local date | ☐ |
| T2.1-4 (valid.) | Bad date | — | `/api/days/2026-13-45` | 422 | ☐ |
| T2.1-5 (valid.) | Range too big | 400 days | summary | 422 | ☐ |
| T2.1-6 (sec.) | No token / other user | — | no Authorization; and request with user B for A's date | 401; only B's data | ☐ |
| T2.1-7 (perf) | Month summary | 60-day data | time | < 500 ms warm | ☐ |
| T2.1-9 (history) | Targets change | user changes calories on D | request days before and after D | earlier days keep the old target; D and later use the new one | ☐ |
| T2.1-8 (regress.) | Old endpoints | — | existing food/water tests | pass | ☐ |

**7. Verification:** [ ] OpenAPI (`/docs`) shows both routes with schemas · [ ] numbers equal the Progress page's weekly numbers for the same week.
**8. Done when:** T2.1-* ✔.
**9. Git Checkpoint**
```bash
git status
git add backend/app backend/tests frontend/src/lib/api
git commit -m "feat(api): day and month summary endpoints"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>` — additive endpoints, no schema change.

---

## Milestone 2.2 — Date-aware dashboard
**Requires:** 2.1
**1. Name:** Today page driven by a selected date.
**2. Objective:** `/today?date=YYYY-MM-DD` renders the same dashboard for any date; default is today.
**3. Tasks**
- [ ] Read `date` from `useSearchParams`; validate; fall back to local today.
- [ ] Load via `GET /api/days/{date}` (diary, water, totals, glass sizes) instead of three calls; suggestions/achievements fetched **only when date = today**.
- [ ] Heading shows the date ("Mon 27 Oct" / "Today"); non-today shows a "Viewing past day" chip and a "Back to today" link.
- [ ] Editing and deleting entries on past dates uses the existing PATCH/DELETE by id (no date restriction); confirm moving an entry between meals works on past days too.
- [ ] Optimistic add/edit/delete/water use the **selected date** (backend `log_food`/`log_water` accept an optional `logged_at`/`date`; extend request models; default now).
- [ ] Keep `data-testid`s.
**4. Files:** `frontend/src/app/today/page.tsx`, `lib/date.ts`, `backend/app/routers/food.py` + `water.py` (optional `log_date`), `backend/app/domain/timeutil.py` (build a noon-local timestamp for a date), tests.
**5. Guidance:** When logging for a past date, set `logged_at` to **12:00 local on that date** unless a time is supplied (avoids DST/midnight edge cases). Validate `log_date ≤ today`. Weight logs/streaks use `logged_at` so backfilled days correctly count toward streaks.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T2.2-1 | Deep link | logs exist on D | open `/today?date=D` | shows that day's meals, water, totals | ☐ |
| T2.2-2 | Default | — | open `/today` | today's date | ☐ |
| T2.2-3 (valid.) | Garbage param | — | `?date=banana` | falls back to today, no crash | ☐ |
| T2.2-4 | Backfill | D = yesterday | add food | appears on D; not on today; streak recalculated | ☐ |
| T2.2-5 (neg.) | Future | `?date=tomorrow+5` | load / try add | blocked with message | ☐ |
| T2.2-6 (edge) | Switch date fast | slow network | change D1→D2→D3 quickly | final view = D3 only (stale responses ignored) | ☐ |
| T2.2-7 (regress.) | Today flows | — | e2e core-journey, optimistic-updates, water-and-progress | pass | ☐ |

**7. Verification:** [ ] totals for D equal `/api/days/D` · [ ] no suggestions call in Network for past dates.
**8. Done when:** T2.2-* ✔.
**9. Git Checkpoint**
```bash
git status
git add frontend/src backend/app backend/tests
git commit -m "feat(today): date-aware diary with backfill logging"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`. Backfilled rows created during testing stay valid data (they are normal logs).

---

## Milestone 2.3 — Calendar UI
**Requires:** 2.2
**1. Name:** Week strip + month popover.
**2. Objective:** A compact week strip at the top of the dashboard (swipe/arrow) and a month calendar sheet; each date shows a status dot (logged / goal hit).
**3. Tasks**
- [ ] `components/DateStrip.tsx`: 7 days, prev/next week, today highlighted, selected date styled, dot under days with logs (from month summary).
- [ ] `components/MonthCalendar.tsx`: month grid in a popover/bottom sheet on mobile; prev/next month; future days disabled.
- [ ] Selecting a date updates the URL (`router.replace(?date=…)`, no full navigation).
- [ ] Keyboard: arrow keys move focus between days, Enter selects, Esc closes; `aria-label="Monday 27 October, logged"`.
- [ ] Prefetch adjacent months' summary.
**4. Files:** `frontend/src/components/DateStrip.tsx`, `MonthCalendar.tsx`, `today/page.tsx`, `lib/date.ts`, `e2e/calendar.spec.ts` (new).
**5. Guidance:** Build the calendar **by hand** (≈150 lines) — a date-picker dependency is heavy for what's needed. Week starts on Monday (matches `week_bounds`). Motion polish (animated selection pill) is added in Phase 6; keep this functional and token-styled now.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T2.3-1 | Select past day | logs on D | click D | URL updates, dashboard switches, dot shown | ☐ |
| T2.3-2 | Month navigation | — | open month, go back 2 months | grid correct, summary loaded | ☐ |
| T2.3-3 (neg.) | Future disabled | — | click tomorrow | not selectable | ☐ |
| T2.3-4 (a11y) | Keyboard only | — | Tab/arrows/Enter/Esc | full operation, visible focus | ☐ |
| T2.3-5 (edge) | Month boundaries / leap year | Feb 2028 | open | 29 days, correct weekday offset | ☐ |
| T2.3-6 (resp.) | 360 px width | emulate | view | no horizontal scroll | ☐ |
| T2.3-7 (fail) | Summary 500 | block request | open month | days still selectable, no dots, no crash | ☐ |
| T2.3-8 (regress.) | Full e2e subset | — | `calendar.spec`, `core-journey`, `responsive-qa` | pass | ☐ |

**7. Verification:** [ ] Lighthouse a11y ≥ 95 on `/today` · [ ] bundle delta < +10 KB.
**8. Done when:** T2.3-* ✔.
**9. Git Checkpoint**
```bash
git status
git add frontend/src frontend/e2e
git commit -m "feat(ui): week strip and month calendar for date selection"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`; `/today?date=` keeps working without the UI.

---

## Milestone 2.4 — Calendar edge rules & polish
**Requires:** 2.3
**1. Name:** Past-day rules, empty states, time zones.
**2. Objective:** Predictable behavior everywhere.
**3. Tasks**
- [ ] Past days show that day's snapshot targets; show the "approximate before Oct 2026" note where the snapshot is the backfill row.
- [ ] Empty-day state with "Log something for this day" CTA.
- [ ] Past-day water: logging allowed; glass quick-buttons work.
- [ ] Timezone change (travel) handled: `browserTimezone()` sync already exists — verify date strip uses profile timezone consistently.
- [ ] Progress & Coach "View in Today" links keep working.
**4. Files:** `today/page.tsx`, `components/DiaryMeal.tsx`, `AchievementsCard` (hide on past dates), e2e.
**5. Guidance:** Don't mutate historical `weekly_reports` (cached, immutable by design) — backfilling a completed week won't change its cached report; mention this in the UI note ("Weekly reports for completed weeks don't change").
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T2.4-1 | Empty past day | — | select empty date | empty state + CTA | ☐ |
| T2.4-2 | Backfill water | past day | add 250 ml | total updates; shows on that day only | ☐ |
| T2.4-3 (edge) | Browser tz ≠ profile tz | set OS tz | open | dates consistent with profile tz | ☐ |
| T2.4-4 (regress.) | Progress weekly | backfill in current week | open Progress | current-week numbers include backfill | ☐ |

**7. Verification:** [ ] manual run through of the three scenarios on phone + desktop.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/src frontend/e2e
git commit -m "feat(calendar): past-day rules, empty states, timezone checks"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`.

### ▶ Phase 2 Completion Checkpoint
| Item | Value |
|---|---|
| Completed | 2.1–2.4 |
| Tests passed | `T2.*`, full e2e |
| Known issues | (fill) |
| Git hash | ____ |
| Overall verification | Click any date → macros, water, diary match the API; works on mobile; keyboard-accessible |
| **Go/No-Go for Phase 3** | Go if full e2e green |
```bash
git tag phase-2-done && git push origin phase-2-done
```

---

# PHASE 3 — Trust, security & correctness (before the redesign touches data flow)

## Milestone 3.1 — Row-Level Security fixes
**Requires:** Phase 2
**1. Name:** Close friendship-approval and food-verification holes.
**2. Objective:** Users cannot self-accept friend requests or create "verified" foods from the browser.
**3. Tasks**
- [ ] New migration: replace `friendships_update_participant` with a policy allowing only the **addressee** to update `status` from `pending`; requester may `delete` their own pending row.
- [ ] `food_items`: change insert/update `WITH CHECK` to require `verified = false`; add trigger blocking any change to `verified` and `is_ai_estimate` by non-service roles.
- [ ] Partial unique index `(created_by, lower(name)) where is_ai_estimate` and make `get_or_create_personal_food` an upsert (audit BUG-4).
- [ ] Extend `backend/tests/test_rls.py` (mark `live`) with the four attacks below.
- [ ] Down-migration file.
**4. Files:** `backend/supabase/migrations/<ts>_rls_friendships_food_items.sql`, `rollbacks/…down.sql`, `backend/app/domain/food_resolution.py`, `backend/tests/test_rls.py`, `docs/DATABASE.md`.
**5. Guidance:** The backend uses the service role, so it is unaffected; the frontend's direct Supabase writes to `friendships`/`food_items` don't exist for these columns (verify with `grep -rn "from(\"friendships\")\|from(\"food_items\")" frontend/src` — only the Realtime *subscribe* remains). Apply to a non-prod project first.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T3.1-1 (sec.) | Requester self-accepts | A→B pending | A (anon key+JWT) `update friendships set status='accepted'` | denied / 0 rows | ☐ |
| T3.1-2 | Addressee accepts via API | pending | B `POST /friends/{id}/respond` | 200 accepted | ☐ |
| T3.1-3 (sec.) | Insert verified food | user token | insert `verified=true` | rejected | ☐ |
| T3.1-4 (sec.) | Self-verify | own food | update `verified=true` | rejected | ☐ |
| T3.1-5 (edge) | Duplicate AI food race | two parallel logs of "paneer" | — | exactly one row | ☐ |
| T3.1-6 (regress.) | Friends & food e2e | — | `friends.spec`, `custom-food.spec`, API tests | pass | ☐ |

**7. Verification:** [ ] `select polname, cmd, qual, with_check from pg_policies where tablename in ('friendships','food_items')` reviewed.
**8. Done when:** all ✔ on the TEST project; the production migration and its rollback SQL are prepared and documented for the owner to apply.
**9. Git Checkpoint**
```bash
git status
git add backend/supabase backend/app backend/tests docs/DATABASE.md
git commit -m "fix(db): restrict friendship updates and food verification"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** run `rollbacks/…down.sql` in Supabase SQL editor, then `git revert <hash>`.

---

## Milestone 3.2 — Server-owned profile & targets
**Requires:** 3.1
**1. Name:** `PUT /api/profile` recomputes targets server-side.
**2. Objective:** Browsers send inputs only; the server computes targets (leaderboard can't be gamed).
**3. Tasks**
- [ ] `PUT /api/profile` takes the existing form inputs (+ weight) and computes via `macros.py`, writes `profiles` and (if changed) `weight_logs` in one request.
- [ ] `POST /api/profile` for onboarding (create).
- [ ] Switch `profile/page.tsx` and `onboarding/page.tsx` from `supabase.from("profiles")…` to these endpoints; keep read via Supabase or move to `GET /api/profile`.
- [ ] Revoke client `INSERT/UPDATE` on `profiles` target columns (column-level `revoke update (target_calories, …)`), keep updates for harmless columns (e.g. `leaderboard_visible`) or move them too.
**4. Files:** new `backend/app/routers/profile.py`, `backend/app/main.py` (also move macro-targets into `routers/macros.py`), `frontend/src/app/profile/page.tsx`, `onboarding/page.tsx`, `lib/ProfileProvider.tsx`, migration for column revokes, tests.
**5. Guidance:** Ship **API + frontend switch first**, deploy, verify, **then** the revoke migration (order matters — revoking first breaks the live app). Keep the custom-macros/calorie-override validation exactly as in `/api/macro-targets`.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T3.2-1 | Onboarding | new user | complete wizard | profile + weight_log created; targets match `/api/macro-targets` | ☐ |
| T3.2-2 | Edit weight/goal | existing | save | targets recalculated, new weight_log only if changed | ☐ |
| T3.2-3 (sec.) | Client tamper | JWT | `supabase.from('profiles').update({target_calories: 99999})` | denied | ☐ |
| T3.2-4 (valid.) | Bad inputs | — | age 0, weight −5, override out of range | 422 with clear message | ☐ |
| T3.2-5 (sec.) | Unauthorized | no token | PUT | 401 | ☐ |
| T3.2-6 (regress.) | e2e | — | `onboarding-targets`, `calorie-macro-engine`, `profile-and-settings` | pass | ☐ |

**7. Verification:** [ ] leaderboard score still computes · [ ] profile cache refetch works.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add backend frontend/src
git commit -m "feat(api): server-side profile and target calculation"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert` code; revoke-migration down file restores grants.

---

## Milestone 3.3 — AI hardening & rate limits
**Requires:** 3.2
**1. Name:** Safe errors, header-auth for Gemini, per-user quotas.
**2. Objective:** No key/errors leaked; one user can't exhaust AI quota.
**3. Tasks**
- [ ] `core/gemini.py`: send key via `x-goog-api-key` header; return generic messages; log details server-side; use `generationConfig.responseMimeType="application/json"` (+ schema) for parse/intent/diet calls; handle `finishReason`/safety blocks.
- [ ] Routers return fixed user-safe `detail` (no `{exc}`); same for JWT errors in `auth.py`.
- [ ] `ai_usage` table (user_id, route, model, tokens_in/out, latency_ms, created_at) + `check_quota` (e.g. 30 AI calls/hour, 200/day — tune from B-answers).
- [ ] 429 with calm message surfaced through `lib/errors.ts`.
**4. Files:** `backend/app/core/gemini.py`, `core/auth.py`, `routers/coach.py|ai_food.py|diet.py`, new `core/quota.py`, migration `ai_usage`, `frontend/src/lib/errors.ts`, tests.
**5. Guidance:** Native JSON mode removes fence-stripping failures (502s) — keep `parse_*` validators as the safety net. Quota check must happen before the Gemini call. Don't store prompts, only metadata (privacy).
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T3.3-1 (sec.) | No leakage | break key | call coach | generic 503, no key/URL in body or logs | ☐ |
| T3.3-2 | Quota | limit=3 in test | 4 calls | 4th → 429 | ☐ |
| T3.3-3 (AI valid.) | Malformed output | mock invalid JSON | calculate-foods | 502 friendly; no partial log | ☐ |
| T3.3-4 (AI safety) | Blocked response | mock safety block | coach | fallback message, no crash | ☐ |
| T3.3-5 (AI fail) | Primary down | mock 500 | coach | fallback model answers (existing test) | ☐ |
| T3.3-6 (explain.) | Provenance | AI estimate | Calculator | still labeled "Estimated" | ☐ |
| T3.3-7 (regress.) | AI e2e | — | `ai-features`, `coach-input` | pass | ☐ |

**7. Verification:** [ ] `grep -rn "{exc}" backend/app/routers` returns nothing user-facing · [ ] `ai_usage` rows appear.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add backend frontend/src/lib/errors.ts
git commit -m "fix(ai): header auth, safe errors, per-user quotas"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`; `ai_usage` table is additive—leave it.

### ▶ Phase 3 Completion Checkpoint
| Item | Value |
|---|---|
| Completed | 3.1–3.3 |
| Tests passed | `T3.*`, `test_rls.py` (non-prod), full e2e |
| Known issues | (fill) |
| Git hash | ____ |
| Overall verification | All four RLS attacks fail; targets only server-set; no secrets in responses |
| **Go/No-Go for Phase 4** | Go only if every security test ✔ |
```bash
git tag phase-3-done && git push origin phase-3-done
```

---

# PHASE 4 — Data layer & backend efficiency

## Milestone 4.1 — Client data layer (TanStack Query) + generated types
**Requires:** Phase 3
**1. Name:** Cache, dedupe, and typed API.
**2. Objective:** Navigating between pages/dates is instant (cached) and revalidates in the background; types can't drift from the backend.
**3. Tasks**
- [ ] Add `@tanstack/react-query` (why: caching/dedupe/optimistic mutations/refetch-on-focus replace ~150 lines of hand-rolled state and the `mutationVersion` hack). Provider in `layout.tsx`.
- [ ] Add `openapi-typescript` (dev) and script `npm run gen:api` against `${API_URL}/openapi.json` → `lib/api/schema.d.ts`; replace hand-written duplicates in `api/data.ts` and `ai.ts`.
- [ ] Hooks: `useDay(date)`, `useMonthSummary(month)`, `useSuggestions()`, `useGlassSizes()`, `useCoachHistory()`, etc. `staleTime` ≈ 30 s for day, 5 min for glass sizes; suggestions invalidated by food mutations.
- [ ] Migrate **Today** first (optimistic mutations via `onMutate/onError/onSettled`), then other pages.
- [ ] Prefetch adjacent dates on calendar hover/focus.
**4. Files:** `frontend/package.json`, `lib/query/*`, `lib/api/*`, `app/today/page.tsx` → then others, `components/*`.
**5. Guidance:** One page at a time, each commit green. Keep optimistic rollback behavior identical to the current UX. Do **not** add Redux/Zustand — Query + local state suffices.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T4.1-1 | Cached navigation | visited Today | go Progress→Today | renders instantly from cache, no spinner | ☐ |
| T4.1-2 | Optimistic add + failure | block POST | add food | row appears then rolls back with message | ☐ |
| T4.1-3 | Dedupe | two components need profile | load | one request in Network | ☐ |
| T4.1-4 (edge) | Logout/login other user | user A then B | switch | no A data visible (cache cleared on sign-out) | ☐ |
| T4.1-5 (types) | Drift guard | change a Pydantic field | `npm run gen:api && tsc` | compile error surfaces | ☐ |
| T4.1-6 (regress.) | Full e2e | — | `npx playwright test` | pass | ☐ |
| T4.1-7 (perf) | JS budget | — | `next build` size | within +40 KB gzip total | ☐ |

**7. Verification:** [ ] React Query Devtools (dev only) shows expected keys.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/package.json frontend/package-lock.json frontend/src
git commit -m "refactor(frontend): react-query data layer and generated API types"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>` (commit per page makes partial rollback possible).

---

## Milestone 4.2 — Heavy endpoints → SQL; async only if measured
**Requires:** 4.1
**1. Name:** Replace Python aggregation loops.
**2. Objective:** Leaderboard, achievements and notification triggers stop scanning 60–90 days of rows in Python.
**3. Tasks**
- [ ] RPC `leaderboard_week(user_id)` → one query for self + friends' weekly adherence and streaks (replaces 2 queries per friend).
- [ ] RPC `logged_dates(user_id, from)` (distinct local dates) used by achievements & notification check.
- [ ] Re-measure with the 0.4 method; only if p95 of data endpoints is still >500 ms under load, convert the hottest routers to `async def` with `httpx.AsyncClient`.
**4. Files:** migration `<ts>_leaderboard_and_logged_dates_rpc.sql` (+ down), `routers/friends.py`, `achievements.py`, `notifications.py`, `domain/*` (keep pure ranking/score functions), tests.
**5. Guidance:** Keep `domain/friends.compute_discipline_score` as the single formula; SQL returns inputs, Python scores — or port the formula with a parity test. Privacy rules (opt-out, presence-only activity) must stay identical.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T4.2-1 (parity) | Same leaderboard | seeded friends | compare old vs new output | identical ranks/scores | ☐ |
| T4.2-2 (sec.) | Opt-out | friend `leaderboard_visible=false` | GET | friend absent | ☐ |
| T4.2-3 (perf) | 10 friends | — | time | < 400 ms warm | ☐ |
| T4.2-4 (tz) | Friend in another timezone | tz differs | GET | each friend bucketed in own tz | ☐ |
| T4.2-5 (regress.) | Existing tests | — | `test_friends_*`, `test_achievements_*`, `test_notifications_*` | pass | ☐ |

**7. Verification:** [ ] `explain analyze` on the RPCs uses the `(user_id, logged_at)` index.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add backend
git commit -m "perf(backend): SQL leaderboard and logged-dates aggregation"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** down-migration + `git revert`.

### ▶ Phase 4 Completion Checkpoint
| Item | Value |
|---|---|
| Completed | 4.1 4.2 |
| Tests passed | `T4.*`, full e2e |
| Known issues | (fill) |
| Git hash | ____ |
| Overall verification | Cached navigation instant; backend p95 < 500 ms; types generated |
| **Go/No-Go for Phase 5** | Go if budgets met |
```bash
git tag phase-4-done && git push origin phase-4-done
```

---

# PHASE 5 — Design system & motion foundation

*Design direction: see section D. Dark by default (near-black ground, green accent), light mode available; futuristic but friendly; big numbers, rings and bars, week dot-grid, insight cards, floating "Add meal" pill; editorial headlines on the landing page; physical, quick motion that respects reduced-motion.*

## Milestone 5.1 — Tokens, typography, icons
**Requires:** Phase 4
**1. Name:** Refresh the visual foundation without changing layouts.
**2. Objective:** New type scale and spacing, mono eyebrow font, light/dark tokens tuned (same green), and a faster icon system.
**3. Tasks**
- [ ] `globals.css`: **dark is the default theme** (near-black ground, green accent) and light is a warm off-white; keep the `--color-primary` green family and the protein/carbs/fat/water semantic colors (Stitch is no longer the source of truth; `docs/DESIGN_RECONCILIATION.md` stays as history only); add `--font-mono`, `--tracking-tight-display`, hairline border token, radius scale.
- [ ] `layout.tsx`: add a mono font via `next/font` (e.g. JetBrains Mono, subset latin, weights 400/500); display font with `display:'swap'`.
- [ ] Remove the Google Fonts Material Symbols `<link>`; replace usages (`grep -rn "material-symbols-outlined" frontend/src`) with an inline SVG icon set (`lucide-react` tree-shaken, or hand-picked SVGs in `components/icons.tsx`). Why: removes a render-blocking font request and fixes the ESLint warning.
- [ ] Contrast check every token pair (WCAG AA) in both modes.
- [ ] Default theme: when no theme cookie exists, render **dark** (server-side in `layout.tsx` and `theme.ts`); the toggle offers Dark / Light / System and the choice persists in the cookie.
**4. Files:** `frontend/src/app/globals.css`, `layout.tsx`, `components/icons.tsx` (or lucide), every file using Material Symbols, `docs/DESIGN_TOKENS.md`.
**5. Guidance:** Tokens only; no layout changes yet so the diff is reviewable and e2e keeps passing. If using `lucide-react`, import named icons only.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T5.1-1 | Icons render | — | visit every route | no missing glyph text ("close", "psychology") | ☐ |
| T5.1-2 | Contrast | tokens | axe / manual | AA pass light & dark | ☐ |
| T5.1-3 | Theme toggle | — | light/dark/system | persists; no flash on reload (cookie SSR kept) | ☐ |
| T5.1-4 (perf) | Fonts | — | Network | no Google Fonts stylesheet from fonts.googleapis.com for icons; CLS ≈ 0 | ☐ |
| T5.1-6 | Dark default | clear cookies, OS set to light | open site | renders dark; toggling to Light persists | ☐ |
| T5.1-5 (regress.) | e2e | — | `theme-hydration`, `app-shell`, `responsive-qa` | pass | ☐ |

**7. Verification:** [ ] `npx eslint` 0 warnings · [ ] Lighthouse best-practices unchanged or better.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend
git commit -m "style: new tokens, mono eyebrow font, inline icons"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`.

---

## Milestone 5.2 — Motion foundation (motion.dev)
**Requires:** 5.1
**1. Name:** Install and configure motion with a performance guardrail.
**2. Objective:** A shared motion vocabulary (spring presets, durations) and reduced-motion support, with minimal bundle cost.
**3. Tasks**
- [ ] `npm i motion` (motion.dev, imports from `motion/react`). Why: declarative springs, layout animations, `AnimatePresence`, gestures—exactly the "enjoyable, physical" feel requested.
- [ ] `lib/motion.ts`: presets `spring.snappy`, `spring.soft`, `ease.out`, durations (fast 120 ms, base 220 ms, slow 400 ms), stagger helper.
- [ ] `MotionProvider` wrapping the app with `<LazyMotion features={domAnimation} strict>` and `<MotionConfig reducedMotion="user">`; use `m.*` components only (smaller bundle than `motion.*`).
- [ ] Animate **only `transform` and `opacity`**; no animating layout properties on lists > 30 items.
- [ ] Optional smooth scroll (Lenis) **only** for the landing page (6.6) — not in the app shell (it adds input latency in a data app).
**4. Files:** `frontend/package.json`, `lib/motion.ts`, `components/MotionProvider.tsx`, `layout.tsx`.
**5. Guidance:** Budget: motion's `domAnimation` + `m` ≈ low-teens KB gzip; verify with `next build` analyzer. Respect `prefers-reduced-motion` (replace movement with instant/opacity changes). Check licenses of any React Bits/21st.dev snippet you copy before using it.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T5.2-1 | Reduced motion | OS setting on | load pages | no movement, content intact | ☐ |
| T5.2-2 | Bundle | — | `ANALYZE=true next build` or compare `.next` stats | motion chunk ≤ ~20 KB gz; `/today` within +40 KB overall | ☐ |
| T5.2-3 | SSR safe | — | `next build && next start` | no hydration warnings | ☐ |
| T5.2-4 (perf) | 60 fps | DevTools Performance | animate list | no long tasks > 50 ms | ☐ |
| T5.2-5 (regress.) | e2e | — | full run | pass (animations don't block clicks) | ☐ |

**7. Verification:** [ ] Playwright config sets `reducedMotion: 'reduce'` for e2e to keep tests deterministic.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/package.json frontend/package-lock.json frontend/src frontend/playwright.config.ts
git commit -m "feat(ui): motion provider, presets, reduced-motion support"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`; `npm ci`.

---

## Milestone 5.3 — Component primitives
**Requires:** 5.2
**1. Name:** Build the reusable pieces once.
**2. Objective:** A small, consistent kit used by every redesigned page.
**3. Tasks** — create in `components/ui/`:
- [ ] `Button` (press scale 0.97, spring), `Card` (hairline border), `Eyebrow` (mono uppercase), `Headline` (supports `<em>`/accent span for the single emphasized phrase), `Sheet` (bottom sheet/side drawer with focus trap), `Toast` (undo support; replaces `window.confirm` for deletes), `Skeleton`, `NumberTicker` (animated count for calories), `ProgressRing`/`MacroBar` (animated), `Tabs`.
- [ ] Storybook is **not** added (extra tooling); instead a dev-only `/_kit` route page showing all primitives in both themes.
**4. Files:** `frontend/src/components/ui/*`, `app/_kit/page.tsx` (excluded from production via `notFound()` unless `NODE_ENV!=='production'`).
**5. Guidance:** Accessibility first (focus rings, `aria-*`, keyboard). Props typed; no business logic in primitives.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T5.3-1 | Keyboard | `/_kit` | Tab through | visible focus, Esc closes Sheet/Toast | ☐ |
| T5.3-2 | Both themes | — | toggle | no contrast failures | ☐ |
| T5.3-3 | Focus trap | Sheet open | Tab repeatedly | focus stays inside; returns to trigger on close | ☐ |
| T5.3-4 (neg.) | `/_kit` hidden in prod | `NODE_ENV=production` | visit | 404 | ☐ |
| T5.3-5 (unit) | NumberTicker | — | value 0→1840 | ends exactly at 1840; reduced-motion jumps | ☐ |

**7. Verification:** [ ] axe: 0 serious issues on `/_kit`.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/src/components/ui frontend/src/app/_kit
git commit -m "feat(ui): design-system primitives"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>` (nothing consumes the primitives yet).

---

## Milestone 5.4 — App shell & navigation redesign
**Requires:** 5.3
**1. Name:** New sidebar, mobile nav, page transitions.
**2. Objective:** Shell that feels fast and alive: animated nav indicator, instant route feel, calm page transitions.
**3. Tasks**
- [ ] Redesign `AppShell`, `AppSidebar`, `BottomNav` with primitives; animated active indicator (`layoutId`).
- [ ] Extract `ProfileEditor` out of `app/profile/page.tsx` so the sidebar no longer imports a route component.
- [ ] Route transitions: opacity+8 px translate (≤180 ms) via a template; **no** blocking on data.
- [ ] Keep `navItems.ts`, collapsed-state persistence, mobile drawer behavior and Esc handling.
**4. Files:** `components/AppShell.tsx`, `AppSidebar.tsx`, `BottomNav.tsx`, new `ProfileEditor.tsx`, `app/template.tsx`, `lib/navItems.ts`.
**5. Guidance:** Transitions must never delay content; if data isn't ready show skeletons (5.3). Don't use View Transitions API yet (browser support/complexity).
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T5.4-1 | Navigate all routes | logged in | click each nav item | indicator animates, correct page, URL | ☐ |
| T5.4-2 | Mobile drawer | 375 px | open/close, Esc, outside click | works; focus returns | ☐ |
| T5.4-3 | Collapse persists | — | collapse, reload | stays collapsed | ☐ |
| T5.4-4 (neg.) | Logged out | — | visit `/today` | redirected to login | ☐ |
| T5.4-5 (regress.) | e2e | — | `app-shell`, `sidebar-hydration-progress`, `profile-and-settings`, `responsive-qa` | pass | ☐ |

**7. Verification:** [ ] INP < 200 ms on nav clicks (DevTools).
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/src
git commit -m "feat(ui): redesigned app shell and navigation with motion"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`.

### ▶ Phase 5 Completion Checkpoint
| Item | Value |
|---|---|
| Completed | 5.1–5.4 |
| Tests passed | `T5.*`, full e2e (reduced motion), axe |
| Known issues | (fill) |
| Git hash | ____ |
| Overall verification | Consistent kit in both themes; reduced-motion respected; no bundle regression beyond budget |
| **Go/No-Go for Phase 6** | Go if a11y + budget pass |
```bash
git tag phase-5-done && git push origin phase-5-done
```

---

# PHASE 6 — Page redesign

*One page per milestone. Every redesign keeps existing `data-testid`s and behavior; only structure, style and motion change. Each page uses skeletons (never blank), cached data (4.1), and the shared primitives.*

## Milestone 6.1 — Today (dashboard) + calendar motion
**Requires:** 5.4
**1. Name:** Redesigned dashboard.
**2. Objective:** The hero screen, per section D: a large animated calorie figure ("1,728 / 2,200") over a thick progress bar, three macro stats with ring gauges, the **week dot-grid** (kcal/fat/carbs/protein dots, Too low / OK / Too high band, selected day outlined) that doubles as the calendar, a streak flame chip, insight cards with status chips (Low / On track / Optimal) computed from existing data, staggered meal cards, tactile water glasses, a suggestions card with skeleton, and a floating **"Add meal"** pill that opens the food picker sheet.
**3. Tasks**
- [ ] Rebuild layout using primitives; keep two-column desktop / single column mobile.
- [ ] Week dot-grid from `GET /api/days/summary` (one dot per macro per day); the selected day opens the full day view. Insight cards derive from the same numbers (no new AI calls).
- [ ] Floating "Add meal" pill (bottom-center on mobile, above the tab bar) opens the FoodPicker in a Sheet; on desktop it docks into the logging column.
- [ ] Keep the in-app notification banner ("someone added Breakfast") restyled with the Toast primitive; no push.
- [ ] Animate: totals on change (spring), macro bars fill, list item enter/exit (`AnimatePresence`, `layout` only on ≤30 items), add-food success micro-interaction, undo toast for delete.
- [ ] Calendar: selection pill via `layoutId`, month sheet slide-up.
- [ ] Skeleton for every async region; no layout shift.
**4. Files:** `app/today/page.tsx`, `components/DiaryMeal.tsx`, `WaterGlasses.tsx`, `SuggestionsCard.tsx`, `DateStrip.tsx`, `MonthCalendar.tsx`, `FoodPicker.tsx` (styling), `AchievementsCard.tsx`.
**5. Guidance:** Never wait on animation to show data; animations are decoration on top of already-rendered values. Use `transform/opacity` only; cap simultaneous animated nodes.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T6.1-1 | Full journey | — | add food, edit qty, delete+undo, add water, switch dates | all work; values correct | ☐ |
| T6.1-2 (perf) | Load | Fast 4G | measure | diary visible ≤1.5 s; CLS < 0.05 | ☐ |
| T6.1-3 (perf) | Interaction | 4× CPU slow | add food | UI responds < 100 ms (optimistic) | ☐ |
| T6.1-4 (a11y) | Reduced motion + keyboard | — | full journey | works; focus visible | ☐ |
| T6.1-5 (resp.) | 360/768/1280 px | — | view | no overflow; layouts correct | ☐ |
| T6.1-6 (fail) | Suggestions/API errors | block endpoints | load | graceful states | ☐ |
| T6.1-7 (regress.) | e2e | — | `core-journey`, `food-log-editing`, `optimistic-updates`, `water-and-progress`, `suggestions`, `calendar` | pass | ☐ |

**7. Verification:** [ ] Lighthouse mobile perf ≥ 85, a11y ≥ 95 · [ ] side-by-side screenshot review light/dark.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/src
git commit -m "feat(ui): redesigned dashboard with motion and calendar"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`; Vercel → previous deployment → Promote.

---

## Milestone 6.2 — Coach
**Requires:** 6.1
**1. Name:** Chat redesign with perceived-speed.
**2. Objective:** Message bubbles with enter animation, typing indicator, suggested prompts, "View in Today" chips; fix history order.
**3. Tasks**
- [ ] Fix BUG-1: backend `get_history` returns the **latest** 100 (order desc, reverse) with `?before=` cursor pagination; "Load earlier" button.
- [ ] Optimistic user message already exists; add animated typing indicator and prompt chips.
- [ ] Fix BUG-2/3 (maintenance answer uses TDEE; no height-as-weight fallback).
**4. Files:** `app/coach/page.tsx`, `backend/app/routers/coach.py`, `domain/coach.py`, `tests/test_coach_*.py`.
**5. Guidance:** Don't stream yet (separate milestone later); keep timeouts from 1.2.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T6.2-1 | History order | 120 messages | open Coach | newest visible, "Load earlier" works | ☐ |
| T6.2-2 | Maintenance Q | profile | "what is my maintenance calories" | returns TDEE, not goal target | ☐ |
| T6.2-3 (edge) | No weight logs | user w/o logs | ask BMI | no height used as weight; graceful message | ☐ |
| T6.2-4 (AI scope) | Out of scope | — | "write python code" | fixed refusal | ☐ |
| T6.2-5 (AI action) | Add food | — | "add 3 eggs to breakfast" | logged; link shown; Today updated | ☐ |
| T6.2-6 (fail) | Gemini down | mock | send | friendly error, input preserved | ☐ |
| T6.2-7 (regress.) | e2e | — | `coach-input`, `ai-features` | pass | ☐ |

**7. Verification:** [ ] unit tests for coach fast path pass.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/src backend
git commit -m "feat(coach): redesigned chat, paginated latest-first history, fixes"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`.

---

## Milestone 6.3 — Calculate (AI) page
**Requires:** 6.2
**1. Name:** Calculator redesign.
**2. Objective:** Review cards with animated totals, clear "Estimated" provenance, ambiguity chooser; DietPlanGenerator restyled.
**3. Tasks:** restyle `ReviewRowCard`, animate totals, skeleton while parsing, keep all resolution logic untouched; extract `page.tsx` (740 lines) into `components/calculate/*`.
**4. Files:** `app/calculate/page.tsx`, `components/calculate/*`, `DietPlanGenerator.tsx`.
**5. Guidance:** Pure refactor + restyle — no change to deterministic conversion code.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T6.3-1 | DB match | — | "200g paneer" | resolves, totals correct | ☐ |
| T6.3-2 | Ambiguous | — | ambiguous phrase | chooser + estimate fallback | ☐ |
| T6.3-3 (AI valid.) | Estimate label | no DB match | calculate | "Estimated" label + assumption text | ☐ |
| T6.3-4 (fail) | Partial save failure | block 2nd POST | confirm 3 foods | first logged, rest retryable, no double-log | ☐ |
| T6.3-5 (edge) | Unit conversion | g vs serving | change unit | amounts convert correctly | ☐ |
| T6.3-6 (regress.) | e2e | — | `ai-features`, `custom-food` | pass | ☐ |

**7. Verification:** [ ] `servings.ts` unit behavior unchanged.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/src
git commit -m "feat(ui): redesigned AI calculator"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`.

---

## Milestone 6.4 — Progress & Friends
**Requires:** 6.3
**1. Name:** Progress and social screens.
**2. Objective:** Editorial progress page (numbered sections, captions, chart), animated leaderboard rank changes, friend list/requests.
**3. Tasks:** restyle with primitives; weekly comparison bars animate; weight chart lazy-loaded; leaderboard `layout` animation on reorder; add a weight quick-log control on Progress (FE-7) via `POST /api/weight-logs` (new, server-validated).
**4. Files:** `app/progress/page.tsx`, `app/friends/page.tsx`, `WeightHistoryChart.tsx`, `ActivityLogger.tsx`, new `backend/app/routers/weight.py`, tests.
**5. Guidance:** New weight endpoint reuses auth/validation patterns; validate 1–400 kg.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T6.4-1 | Log weight | — | enter 74.2 kg | chart + "lower than last" celebration | ☐ |
| T6.4-2 (valid.) | Bad weight | — | 0, 500, text | rejected inline | ☐ |
| T6.4-3 | Leaderboard privacy | friend opted out | view | hidden | ☐ |
| T6.4-4 (sec.) | Request flow | — | send/accept/decline | statuses correct; no self-accept | ☐ |
| T6.4-5 (resp.) | Mobile | 360 px | view | no overflow | ☐ |
| T6.4-6 (regress.) | e2e | — | `friends`, `achievements`, `water-and-progress` | pass | ☐ |

**7. Verification:** [ ] weekly numbers equal pre-redesign values for same data.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/src backend
git commit -m "feat(ui): redesigned progress and friends, weight quick-log"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`.

---

## Milestone 6.5 — Auth, onboarding, profile
**Requires:** 6.4
**1. Name:** First-run experience.
**2. Objective:** Login/signup/onboarding/profile with the same visual language; animated step transitions; password reset flow added.
**3. Tasks:** restyle; animated wizard steps; add "Forgot password" using Supabase `resetPasswordForEmail` + `/reset-password` page (updateUser); keep server-side profile endpoints from 3.2.
**4. Files:** `app/login`, `signup`, `onboarding`, `profile`, new `app/reset-password/page.tsx`, `components/ProfileEditor.tsx`.
**5. Guidance:** Add the reset redirect URL in Supabase Auth → URL Configuration (prod + localhost). Don't store passwords anywhere in your code.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T6.5-1 | Signup→onboarding→today | new email | complete | lands on Today with targets | ☐ |
| T6.5-2 (neg.) | Wrong password | — | login | friendly error, no leak | ☐ |
| T6.5-3 | Reset | existing | request + follow email link | new password works | ☐ |
| T6.5-4 (valid.) | Validation | — | empty/short fields | inline errors | ☐ |
| T6.5-5 (sec.) | Logged-out access | — | visit `/profile` | redirect/login prompt | ☐ |
| T6.5-6 (regress.) | e2e | — | `auth-redesign`, `onboarding-targets`, `profile-and-settings` | pass | ☐ |

**7. Verification:** [ ] email links point to the production domain.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/src
git commit -m "feat(ui): redesigned auth, onboarding, profile; password reset"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`.

---

## Milestone 6.6 — Landing page (required)
**Requires:** 6.5
**1. Name:** Editorial home at `/` for logged-out visitors.
**2. Objective:** Hero with the real product (live-looking dashboard UI), tight headline with one green-emphasized phrase, mono eyebrow, scroll-triggered reveals; logged-in users still go to Today.
**3. Tasks:** `app/page.tsx` branches on session; static, server-rendered hero; sections: product screenshot, 3 numbered features (not identical card grid), CTA; Lenis smooth scroll **scoped here only** (`lenis` package) with reduced-motion bypass. Per section D: dark-default editorial hero with one italic green accent phrase, mono eyebrow label, hairline rules, numbered sections (01 / 02 / 03), a "FIG. 1" caption under a **live, interactive dashboard preview** (real components with sample data, not an image), corner-bracket call-to-action card, nav with Light/Dark toggle and Log in / Get started. Sample data only; no user data on the landing page.
**4. Files:** `app/page.tsx`, `components/landing/*`, `package.json` (lenis).
**5. Guidance:** Real screenshots from the app, no stock imagery; keep JS minimal (mostly server components). Why Lenis only here: marketing scroll feel without taxing the app.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T6.6-1 | Logged-out | — | visit `/` | landing | ☐ |
| T6.6-2 | Logged-in | session | visit `/` | redirect to Today | ☐ |
| T6.6-3 (perf) | Lighthouse | — | mobile | perf ≥ 90, LCP < 2.5 s | ☐ |
| T6.6-4 (a11y) | Reduced motion | — | enable | no scroll hijack/animations | ☐ |
| T6.6-5 (regress.) | e2e | — | `pwa-and-bootstrap`, `app-shell` | pass | ☐ |

**7. Verification:** [ ] OG/meta tags set. **8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend
git commit -m "feat(ui): editorial landing page"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`.

### ▶ Phase 6 Completion Checkpoint
| Item | Value |
|---|---|
| Completed | 6.1–6.6 |
| Tests passed | `T6.*`, full e2e, axe, Lighthouse |
| Known issues | (fill) |
| Git hash | ____ |
| Overall verification | Every route redesigned, in both themes, within budgets |
| **Go/No-Go for Phase 7** | Go if full e2e green |
```bash
git tag phase-6-done && git push origin phase-6-done
```

---

# PHASE 7 — Remaining correctness fixes

## Milestone 7.1 — Small bug batch
**Requires:** Phase 6
**1. Name:** Close remaining audit bugs.
**2. Objective:** Ship fixes with tests.
**3. Tasks**
- [ ] BUG-5: notification de-dupe key includes the reminder time (`NotificationPoller`).
- [ ] BUG-6: `delete_glass_size` returns 404 for missing/foreign id.
- [ ] BUG-7: fix `sw.js` comment; cache `_next/static` with a versioned cache name **or** remove the claim (decide; offline mode is out of scope).
- [ ] Remove unused starter SVGs from `public/`.
**4. Files:** `NotificationPoller.tsx`, `routers/water.py`, `public/sw.js`, `public/*.svg`, tests.
**5. Guidance:** If you choose real offline later, it needs its own phase with sync/conflict tests — not bundled here.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T7.1-1 | Two reminders | two reminder times | simulate both windows | each fires once | ☐ |
| T7.1-2 (neg.) | Delete foreign glass | user A's id as B | DELETE | 404 | ☐ |
| T7.1-3 | SW update | — | deploy new SW | old cache cleaned; app loads | ☐ |
| T7.1-4 (regress.) | e2e | — | `notifications`, `pwa-and-bootstrap` | pass | ☐ |

**7. Verification:** [ ] Application tab shows only the current cache name. **8. Done when:** ✔.
**9. Git Checkpoint**
```bash
git status
git add frontend backend
git commit -m "fix: reminder dedupe, glass-size 404, service worker cleanup"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** `git revert <hash>`.

### ▶ Phase 7 Completion Checkpoint
Completed: 7.1 · Tests: `T7.*` · Known issues: (fill) · Hash: ____ · Verification: full e2e · **Go/No-Go for Phase 8:** Go if green.
```bash
git tag phase-7-done && git push origin phase-7-done
```

---

# PHASE 8 — Release hardening & deployment

## Milestone 8.1 — Full regression, accessibility, performance
**Requires:** Phase 7
**1. Name:** Prove the whole app.
**2. Objective:** Final evidence against the budgets.
**3. Tasks**
- [ ] Run the full Playwright suite against a **staging** stack (separate Supabase project/branch + Render preview + Vercel preview).
- [ ] axe-core pass on every route (add `@axe-core/playwright` in an `a11y.spec.ts`).
- [ ] Lighthouse mobile on `/`, `/login`, `/today`, `/coach`, `/progress`; record to `docs/PERF_AFTER.md` vs baseline.
- [ ] Manual device pass: Android Chrome, iOS Safari (installed PWA), desktop Chrome/Firefox.
- [ ] Load test light: `k6` or `hey` — 20 concurrent users on data endpoints; AI endpoints 5 concurrent.
**4. Files:** `frontend/e2e/a11y.spec.ts`, `docs/PERF_AFTER.md`.
**5. Guidance:** Staging ≠ production — never point e2e at the production Supabase.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T8.1-1 | Full e2e | staging | `npx playwright test` | 100 % pass (≤1 retry on AI specs) | ☐ |
| T8.1-2 | a11y | — | `a11y.spec.ts` | 0 serious/critical | ☐ |
| T8.1-3 (perf) | Budgets | throttled | Lighthouse | Today diary ≤1.5 s; perf ≥85 | ☐ |
| T8.1-4 (load) | Concurrency | k6 | 20 VUs, 2 min | p95 data < 500 ms, error rate < 1 % | ☐ |
| T8.1-5 (sec.) | Auth matrix | — | call every `/api/*` without token and with another user's ids | 401 / own data only | ☐ |
| T8.1-6 (cross-device) | Devices | — | manual checklist | pass | ☐ |

**7. Verification:** [ ] `PERF_AFTER.md` shows improvement vs `PERF_BASELINE.md`.
**8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add frontend/e2e docs/PERF_AFTER.md
git commit -m "test: a11y suite and post-optimization performance report"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
```
**10. Rollback:** tests/docs only → `git revert <hash>`.

---

## Milestone 8.2 — Production deploy & documentation
**Requires:** 8.1
**1. Name:** Ship and document.
**2. Objective:** Production on the latest `main` with a documented runbook.
**3. Tasks**
- [ ] Write `docs/PRODUCTION_MIGRATIONS.md`: the ordered list of new migration files and their `rollbacks/*.down.sql`, with the order caveat from 3.2 (API + frontend deployed **before** the privilege-revoking migration). **The owner applies them to production** after a Supabase backup (dashboard → Database → Backups, or `pg_dump`). I do not run anything on production.
- [ ] Confirm production env vars: Render (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CORS_ALLOW_ORIGINS=["https://macromate-two.vercel.app"]`, `ENVIRONMENT=production`), Vercel (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- [ ] Owner: merge `macromate-upgrades` into `main`, redeploy Render and Vercel manually, then smoke test (signup→onboarding→log→calendar→coach).
- [ ] Write `README.md` (root), `docs/DEPLOY.md` (hosts, env vars, migration process, rollback), update `docs/DATABASE.md`, replace the template `frontend/README.md`.
- [ ] Tag `v2.0.0`.
**4. Files:** `README.md`, `docs/DEPLOY.md`, `docs/DATABASE.md`, `frontend/README.md`.
**5. Guidance:** Migrations before code that needs them; destructive/revoke migrations last. Keep the baseline tag for 30 days.
**6. Tests**

| ID | Scenario | Pre | Steps | Expected | Status |
|---|---|---|---|---|---|
| T8.2-1 | Prod smoke | deployed | run checklist above | all pass | ☐ |
| T8.2-2 | CORS | — | browser calls from prod origin; curl with other Origin | allowed / blocked | ☐ |
| T8.2-3 (sec.) | RLS in prod | — | rerun the four attacks (3.1) with prod anon key + test user | all denied | ☐ |
| T8.2-4 (rollback drill) | Revert | — | in Vercel/Render promote previous deployment, then forward again | both work | ☐ |
| T8.2-5 | Docs | — | follow `DEPLOY.md` from scratch on a clean machine | app runs locally | ☐ |

**7. Verification:** [ ] uptime monitor green 24 h after release. **8. Done when:** ✔ all.
**9. Git Checkpoint**
```bash
git status
git add README.md docs frontend/README.md
git commit -m "docs: deployment runbook and project readme"
git log -1 --format=%B | grep -i "co-authored\|generated with" && echo "REMOVE TRAILER" || echo "author check OK"
git push origin macromate-upgrades
git tag v2.0.0 && git push origin v2.0.0
# the owner merges macromate-upgrades into main and redeploys manually when satisfied
```
**10. Rollback:** Vercel: Deployments → previous → *Promote to Production*. Render: Deploys → previous → *Rollback*. Code: `git revert -m 1 <merge-hash>` on `main` (never force-push). DB: apply the matching `rollbacks/*.down.sql` (restore from backup only for data loss).

### ▶ Phase 8 Completion Checkpoint
Completed: 8.1 8.2 · Tests: `T8.*` · Known issues: (fill) · Hash: ____ · Verification: production smoke + 24 h monitoring · **Go/No-Go:** Go = release accepted.

---

# FINAL RELEASE CHECKLIST

**Functionality**
- [ ] Dashboard diary visible ≤1.5 s warm; suggestions load independently and never block it
- [ ] Calendar: any past date shows macros, water, diary, activity; future dates blocked; backfill works
- [ ] AI features (Coach, Calculator, Diet plan) work, are labeled as estimates, and fail gracefully
- [ ] Friends, achievements, progress, notifications (in-app) unchanged in behavior
- [ ] Light/dark both polished; green/white theme retained

**Testing**
- [ ] `tsc`, `eslint`, `next build`, `pytest -m "not live"` green in CI
- [ ] Full Playwright suite green on staging; a11y suite 0 serious issues
- [ ] RLS attack tests pass; auth matrix (no token / other user) pass
- [ ] AI tests: malformed output, safety block, provider outage, out-of-scope refusal

**Security**
- [ ] No secrets in repo/history; exposed keys rotated; `.codex/` ignored
- [ ] `npm audit --omit=dev` and `pip-audit` (or `uv pip audit`) clean of critical/high
- [ ] Friendship/food_items/profile write paths locked; Gemini key never in URLs/responses; AI quotas live
- [ ] CORS limited to the production origin

**Performance**
- [ ] Budgets (rule C5) met and recorded in `PERF_AFTER.md`; Lighthouse mobile ≥85 on app routes
- [ ] Backend p95 < 500 ms warm (non-AI); no cold-start hang
- [ ] Motion: 60 fps on mid-range phone; reduced-motion respected

**Deployment**
- [ ] Migrations applied to prod in order; rollback SQL present for each
- [ ] Vercel & Render env vars verified; uptime monitor active; rollback drill performed

**Documentation**
- [ ] README, `DEPLOY.md`, `DATABASE.md`, `DESIGN_TOKENS.md`, `PERF_BASELINE.md`, `PERF_AFTER.md` current

**Git repository cleanliness**
- [ ] `git status` clean; no `.env`, `node_modules`, `.next`, `test-results`, `__pycache__`, `.codex` tracked (`git ls-files | grep -E "\.env$|node_modules|\.next|__pycache__|\.codex"` is empty)
- [ ] All commits authored by you only: `git log --format=%B | grep -ic "co-authored-by"` prints `0`
- [ ] Tags present: `baseline-2026-10-27`, `phase-0-done` … `phase-7-done`, `v2.0.0`
- [ ] `macromate-upgrades` merged into `main` by the owner only after local sign-off; `main` untouched until then
