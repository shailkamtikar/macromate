from datetime import date

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin
from app.domain.timeutil import day_bounds_utc, local_today

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


@router.get("/water-logs", response_model=WaterSummaryResponse)
def list_water_logs(
    current_user: CurrentUserDep,
    log_date: date | None = Query(default=None, alias="date"),
) -> WaterSummaryResponse:
    db = SupabaseAdmin()
    profiles = db.select(
        "profiles", {"id": f"eq.{current_user.user_id}", "select": "timezone"}
    )
    tz_name = profiles[0].get("timezone") if profiles else None
    day_start, day_end = day_bounds_utc(log_date or local_today(tz_name), tz_name)

    rows = db.select(
        "water_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lt.{day_end.isoformat()}"],
            "order": "logged_at.asc",
        },
    )
    logs = [WaterLogOut(**r) for r in rows]
    return WaterSummaryResponse(total_ml=sum(l.volume_ml for l in logs), logs=logs)


@router.post("/water-logs", response_model=WaterLogOut)
def log_water(payload: LogWaterRequest, current_user: CurrentUserDep) -> WaterLogOut:
    db = SupabaseAdmin()
    row = db.insert(
        "water_logs",
        {"user_id": current_user.user_id, "volume_ml": payload.volume_ml},
    )[0]
    return WaterLogOut(**row)


@router.delete("/water-logs/{water_log_id}", status_code=204)
def delete_water_log(water_log_id: str, current_user: CurrentUserDep) -> None:
    db = SupabaseAdmin()
    db._request(
        "DELETE",
        "water_logs",
        params={"id": f"eq.{water_log_id}", "user_id": f"eq.{current_user.user_id}"},
    )
