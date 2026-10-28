# MacroMate frontend

Next.js (App Router), React 19, Tailwind 4, TanStack Query, motion.dev. See the root [README](../README.md) and [docs/DEPLOY.md](../docs/DEPLOY.md).

```bash
npm ci
cp .env.example .env.local     # NEXT_PUBLIC_API_URL + the Supabase URL / anon key (TEST project locally)
npm run dev                    # http://localhost:3000
npx tsc --noEmit && npx eslint && npx playwright test
```

Structure: `src/app` (routes) · `src/components` (UI; `ui/` = motion, sheet, toast primitives) · `src/lib` (`api/` split into `data` and `ai` clients with separate timeouts, `useDay` for the calendar-aware dashboard, query provider) · `e2e` (Playwright specs).

Theme: dark by default (server-rendered from a cookie), light and system available. Animations use `transform`/`opacity` only and respect `prefers-reduced-motion`.
