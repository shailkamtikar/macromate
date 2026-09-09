# MacroMate Backend

FastAPI service for MacroMate. Owns all deterministic business logic (macro/BMI/TDEE
calculations, food-suggestion matching, weekly report generation) and orchestrates the
AI layer (Gemini) and Supabase (Postgres/Auth/Realtime). See [`../docs/MACROMATE_PRD.md`](../docs/MACROMATE_PRD.md)
for product requirements.

## Setup

```bash
cd backend
uv sync
cp .env.example .env   # then fill in real values
uv run uvicorn app.main:app --reload
```

## Tests

```bash
uv run pytest
```
