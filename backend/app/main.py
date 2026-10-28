import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.auth import CurrentUserDep
from app.core.config import get_settings
from app.core.supabase_admin import SupabaseAdmin
from app.routers.achievements import router as achievements_router
from app.routers.activity import router as activity_router
from app.routers.ai_food import router as ai_food_router
from app.routers.coach import router as coach_router
from app.routers.days import router as days_router
from app.routers.diet import router as diet_router
from app.routers.food import router as food_router
from app.routers.friends import router as friends_router
from app.routers.macros import router as macros_router
from app.routers.notifications import router as notifications_router
from app.routers.profile import router as profile_router
from app.routers.progress import router as progress_router
from app.routers.suggestions import router as suggestions_router
from app.routers.water import router as water_router

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("macromate.requests")

app = FastAPI(title="MacroMate API", version="0.1.0")


@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    """Logs every request with its class (`ai` = Gemini-backed under
    /api/ai/, `data` = everything else) and duration, and exposes the
    duration to the browser via Server-Timing -- so slow AI calls are
    visibly separate from data calls in logs and DevTools."""
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    request_class = "ai" if request.url.path.startswith("/api/ai/") else "data"
    response.headers["Server-Timing"] = f"app;dur={elapsed_ms:.0f}"
    logger.info(
        "class=%s method=%s path=%s status=%s duration_ms=%.0f",
        request_class,
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(food_router)
app.include_router(water_router)
app.include_router(ai_food_router)
app.include_router(coach_router)
app.include_router(suggestions_router)
app.include_router(diet_router)
app.include_router(days_router)
app.include_router(macros_router)
app.include_router(profile_router)
app.include_router(progress_router)
app.include_router(achievements_router)
app.include_router(friends_router)
app.include_router(notifications_router)
app.include_router(activity_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}


@app.get("/health/deep")
def health_deep() -> dict[str, str]:
    """Reachability check for the dependencies the app needs: Supabase (a
    1-row read) and whether a Gemini key is configured. It never calls
    Gemini itself, so it costs no AI quota."""
    try:
        SupabaseAdmin().select("glass_sizes", {"select": "id", "limit": "1"})
        supabase_status = "ok"
    except Exception as exc:  # noqa: BLE001 - report, never raise, from a health check
        logger.warning("deep health: supabase check failed: %s", exc)
        supabase_status = "unreachable"
    return {
        "supabase": supabase_status,
        "gemini_key": "present" if settings.gemini_api_key else "missing",
        "environment": settings.environment,
    }


@app.get("/api/me")
def me(current_user: CurrentUserDep) -> dict[str, str | None]:
    """Proves the Supabase Auth JWT verification pipeline works end to end:
    requires a real access token from a real Supabase Auth session, verified
    against the project's live JWKS — no bypass, no fake session."""
    return {"user_id": current_user.user_id, "email": current_user.email}
