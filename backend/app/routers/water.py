from datetime import date

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin
from app.domain.timeutil import day_bounds_utc, local_today
from app.domain.water import plan_water_removal

router = APIRouter(prefix="/api", tags=["water"])


class GlassSizeOut(BaseModel):
    id: str
    label: str
    volume_ml: float


class CreateGlassSizeRequest(BaseModel):
    label: str = Field(min_length=1, max_length=50)
    volume_ml: float = Field(gt=0, le=10000)


class WaterLogOut(BaseModel):
    id: str
    volume_ml: float
    logged_at: str


class LogWaterRequest(BaseModel):
    volume_ml: float = Field(gt=0, le=10000)


class WaterSummaryResponse(BaseModel):
    total_ml: float
    logs: list[WaterLogOut]


@router.get("/glass-sizes", response_model=list[GlassSizeOut])
def list_glass_sizes(current_user: CurrentUserDep) -> list[GlassSizeOut]:
    db = SupabaseAdmin()
    rows = db.select(
        "glass_sizes",
        {"user_id": f"eq.{current_user.user_id}", "order": "volume_ml.asc"},
    )
    return [GlassSizeOut(**r) for r in rows]


@router.post("/glass-sizes", response_model=GlassSizeOut)
def create_glass_size(
    payload: CreateGlassSizeRequest, current_user: CurrentUserDep
) -> GlassSizeOut:
    db = SupabaseAdmin()
    row = db.insert(
        "glass_sizes",
        {
            "user_id": current_user.user_id,
            "label": payload.label,
            "volume_ml": payload.volume_ml,
        },
    )[0]
    return GlassSizeOut(**row)


@router.delete("/glass-sizes/{glass_size_id}", status_code=204)
def delete_glass_size(glass_size_id: str, current_user: CurrentUserDep) -> None:
    db = SupabaseAdmin()
    # Scope the delete by user_id too, not just id — never trust that a
    # client-supplied path id belongs to the caller.
    db._request(
        "DELETE",
        "glass_sizes",
        params={"id": f"eq.{glass_size_id}", "user_id": f"eq.{current_user.user_id}"},
    )


def _day_water_rows(db: SupabaseAdmin, user_id: str, log_date: date | None) -> list[dict]:
    """Today's (or `log_date`'s) water logs for this user, in the user's own
    timezone-aware day boundaries."""
    profiles = db.select("profiles", {"id": f"eq.{user_id}", "select": "timezone"})
    tz_name = profiles[0].get("timezone") if profiles else None
    day_start, day_end = day_bounds_utc(log_date or local_today(tz_name), tz_name)
    return db.select(
        "water_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lt.{day_end.isoformat()}"],
            "order": "logged_at.asc",
        },
    )


def _summarize(rows: list[dict]) -> WaterSummaryResponse:
    logs = [WaterLogOut(**r) for r in rows]
    return WaterSummaryResponse(total_ml=sum(l.volume_ml for l in logs), logs=logs)


@router.get("/water-logs", response_model=WaterSummaryResponse)
def list_water_logs(
    current_user: CurrentUserDep,
    log_date: date | None = Query(default=None, alias="date"),
) -> WaterSummaryResponse:
    db = SupabaseAdmin()
    return _summarize(_day_water_rows(db, current_user.user_id, log_date))


@router.post("/water-logs", response_model=WaterLogOut)
def log_water(payload: LogWaterRequest, current_user: CurrentUserDep) -> WaterLogOut:
    db = SupabaseAdmin()
    row = db.insert(
        "water_logs",
        {"user_id": current_user.user_id, "volume_ml": payload.volume_ml},
    )[0]
    return WaterLogOut(**row)


@router.post("/water-logs/remove", response_model=WaterSummaryResponse)
def remove_water(
    payload: LogWaterRequest, current_user: CurrentUserDep
) -> WaterSummaryResponse:
    """Subtract exactly one container's worth from today, newest log first.

    This is the "−" control on the glass tracker: an undo for a glass the
    user logged by mistake. It never takes the day below zero — if less
    than one container is logged, it removes what's there and stops. A log
    only partially absorbed (a 500 ml bottle when a 250 ml glass is
    subtracted) is reduced rather than deleted, so the day's real total
    stays correct.
    """
    db = SupabaseAdmin()
    rows = _day_water_rows(db, current_user.user_id, None)
    plan = plan_water_removal(rows, payload.volume_ml)

    for log_id in plan.delete_ids:
        # Scoped by user_id as well as id — the ids come from this user's
        # own rows, but never issue an unscoped write regardless.
        db._request(
            "DELETE",
            "water_logs",
            params={"id": f"eq.{log_id}", "user_id": f"eq.{current_user.user_id}"},
        )
    if plan.adjust is not None:
        log_id, remaining_ml = plan.adjust
        db.update(
            "water_logs",
            {"id": f"eq.{log_id}", "user_id": f"eq.{current_user.user_id}"},
            {"volume_ml": remaining_ml},
        )

    return _summarize(_day_water_rows(db, current_user.user_id, None))


@router.delete("/water-logs/{water_log_id}", status_code=204)
def delete_water_log(water_log_id: str, current_user: CurrentUserDep) -> None:
    db = SupabaseAdmin()
    db._request(
        "DELETE",
        "water_logs",
        params={"id": f"eq.{water_log_id}", "user_id": f"eq.{current_user.user_id}"},
    )
