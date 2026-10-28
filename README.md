# MacroMate

Macro tracking, an AI nutrition coach, a calendar of every day you logged, and friendly accountability — as a fast installable web app.

- **Frontend:** Next.js (App Router) · React 19 · Tailwind 4 · TanStack Query · motion.dev — `frontend/`
- **Backend:** FastAPI · Supabase (Postgres, Auth, RLS) · Gemini (primary + fallback model) — `backend/`
- **Docs:** [`docs/MACROMATE_PRD.md`](docs/MACROMATE_PRD.md) (product), [`docs/DATABASE.md`](docs/DATABASE.md) (schema), [`docs/DEPLOY.md`](docs/DEPLOY.md) (run & deploy), [`docs/PRODUCTION_MIGRATIONS.md`](docs/PRODUCTION_MIGRATIONS.md) (upgrade runbook), [`docs/PERF_BASELINE.md`](docs/PERF_BASELINE.md) / [`docs/PERF_AFTER.md`](docs/PERF_AFTER.md) (speed)

## Run it locally

```bash
# backend (http://127.0.0.1:8000)
cd backend && uv sync && cp .env.example .env   # fill in a TEST Supabase project
uv run uvicorn app.main:app --reload

# frontend (http://localhost:3000)
cd frontend && npm ci && cp .env.example .env.local
npm run dev
```

Details, test data and environment switching: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Tests

```bash
cd backend && uv run pytest -m "not live"     # offline, runs in CI
cd backend && uv run pytest -m live           # real Supabase + Gemini (TEST project only!)
cd frontend && npx tsc --noEmit && npx eslint && npx playwright test
```
