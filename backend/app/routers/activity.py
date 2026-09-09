"""Health / activity data (PRD §3.9).

PLATFORM LIMITATION, not a missing credential: Android's Health Connect and
iOS's HealthKit are both native-OS APIs with zero web/JavaScript surface.
There is no browser API, no web SDK, and no "web version" of either —
they're callable only from native Android (Kotlin/Java via the Health
Connect Jetpack library) or native iOS (Swift/ObjC) app code. A Next.js
PWA, however well-built, architecturally cannot call them; this isn't
something any API key or config would unlock. Automatic sync would require
shipping an actual native app shell (e.g. Capacitor/React Native wrapping
this same backend) — out of scope for this web/PWA build, and arguably
consistent with the PRD's own §7 "native apps out of scope for v1."

What IS genuinely implemented: manual activity entry against the same
activity_logs table §5 already defines, with source='manual' — a real,
usable fallback that still feeds the daily activity summary, rather than
a fake/simulated Health Connect integration.
"""

from datetime import date

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin

router = APIRouter(prefix="/api/activity-logs", tags=["activity"])


class ActivityLogOut(BaseModel):
    id: str
    source: str
    activity_date: str
    steps: int | None
    active_calories: float | None
    workout_minutes: float | None


class LogActivityRequest(BaseModel):
    activity_date: date
    steps: int | None = Field(default=None, ge=0)
    active_calories: float | None = Field(default=None, ge=0)
    workout_minutes: float | None = Field(default=None, ge=0)


@router.get("", response_model=list[ActivityLogOut])
def list_activity_logs(
    current_user: CurrentUserDep,
    start: date = Query(),
    end: date = Query(),
) -> list[ActivityLogOut]:
    db = SupabaseAdmin()
    rows = db.select(
        "activity_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "activity_date": [f"gte.{start.isoformat()}", f"lte.{end.isoformat()}"],
            "order": "activity_date.asc",
        },
    )
    return [ActivityLogOut(**r) for r in rows]


@router.put("", response_model=ActivityLogOut)
def upsert_manual_activity(
    payload: LogActivityRequest, current_user: CurrentUserDep
) -> ActivityLogOut:
    """One row per (user, source, date) — see the unique constraint in the
    schema — so re-submitting the same day's manual entry updates it
    rather than duplicating."""
    db = SupabaseAdmin()
    row = db.insert(
        "activity_logs",
        {
            "user_id": current_user.user_id,
            "source": "manual",
            "activity_date": payload.activity_date.isoformat(),
            "steps": payload.steps,
            "active_calories": payload.active_calories,
            "workout_minutes": payload.workout_minutes,
        },
        prefer="resolution=merge-duplicates,return=representation",
        on_conflict="user_id,source,activity_date",
    )[0]
    return ActivityLogOut(**row)
