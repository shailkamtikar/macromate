"""Per-user limits on AI calls, plus an audit trail in `ai_usage`.

Why: Gemini's free tier is rationed per API key, not per user, so one account
spamming Coach could lock everyone out (and every call also holds a worker
thread for seconds). Limits are deliberately generous for a human and
restrictive for a script:

  * a sliding per-minute window (checked in memory, no DB round trip), and
  * a per-UTC-day ceiling (counter hydrated from `ai_usage` once per user per
    process, then kept in memory).

Each Render instance enforces its own counters; with a single instance that
is exact, with several it is a (still useful) per-instance bound. The audit
rows are written on a background thread so they never add latency, and a
failed audit write is only logged -- it must never fail the user's request.
"""

import logging
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from app.core.config import get_settings

logger = logging.getLogger("macromate.quota")


class QuotaExceeded(Exception):
    """Raised before any Gemini call is made. `retry_after_seconds` is a hint
    for the Retry-After header; `message` is safe to show to a user."""

    def __init__(self, message: str, retry_after_seconds: int):
        super().__init__(message)
        self.message = message
        self.retry_after_seconds = retry_after_seconds


_lock = threading.Lock()
_minute_calls: dict[str, deque[float]] = defaultdict(deque)
# user_id -> (utc date string, calls so far that day)
_day_counts: dict[str, tuple[str, int]] = {}
_writer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ai-usage")


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _hydrate_day_count(user_id: str, day: str) -> int:
    """Calls this user already made today, from the audit table. Fails open
    (0) if the database is unreachable: better to allow a call than to block
    a user because of an audit-store hiccup."""
    try:
        from app.core.supabase_admin import SupabaseAdmin

        rows = SupabaseAdmin().select(
            "ai_usage",
            {
                "user_id": f"eq.{user_id}",
                "created_at": f"gte.{day}T00:00:00+00:00",
                "select": "id",
            },
        )
        return len(rows)
    except Exception as exc:  # noqa: BLE001
        logger.warning("quota: could not read ai_usage (%s); counting from 0", type(exc).__name__)
        return 0


def check_and_reserve(user_id: str, now: float | None = None) -> None:
    """Raises QuotaExceeded if the user is over a limit; otherwise counts this
    call against both limits."""
    settings = get_settings()
    per_minute = settings.ai_calls_per_minute
    per_day = settings.ai_calls_per_day
    now = time.monotonic() if now is None else now
    day = _today()

    with _lock:
        stored = _day_counts.get(user_id)
    if stored is None or stored[0] != day:
        hydrated = _hydrate_day_count(user_id, day)
        with _lock:
            _day_counts[user_id] = (day, hydrated)

    with _lock:
        window = _minute_calls[user_id]
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= per_minute:
            retry = max(1, int(60 - (now - window[0])))
            raise QuotaExceeded(
                "You're going a bit fast — please wait a moment and try again.", retry
            )
        _, count = _day_counts[user_id]
        if count >= per_day:
            raise QuotaExceeded(
                "You've reached today's AI limit. It resets tomorrow — everything else keeps working.",
                3600,
            )
        window.append(now)
        _day_counts[user_id] = (day, count + 1)


def record_usage(user_id: str, route: str, usage: dict | None, *, success: bool) -> None:
    """Writes one audit row (model, tokens, latency) off the request path."""
    row = {
        "user_id": user_id,
        "route": route or "unknown",
        "model": (usage or {}).get("model"),
        "prompt_tokens": (usage or {}).get("prompt_tokens"),
        "output_tokens": (usage or {}).get("output_tokens"),
        "latency_ms": (usage or {}).get("latency_ms"),
        "success": success,
    }

    def write() -> None:
        try:
            from app.core.supabase_admin import SupabaseAdmin

            SupabaseAdmin().insert("ai_usage", row)
        except Exception as exc:  # noqa: BLE001
            logger.warning("quota: could not record ai_usage (%s)", type(exc).__name__)

    if get_settings().record_ai_usage:
        _writer.submit(write)


def reset_for_tests() -> None:
    with _lock:
        _minute_calls.clear()
        _day_counts.clear()
