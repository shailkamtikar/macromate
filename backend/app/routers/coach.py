from datetime import datetime, time, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.gemini import GeminiUnavailable, generate_text
from app.core.supabase_admin import SupabaseAdmin
from app.domain.coach import (
    COACH_SYSTEM_INSTRUCTION,
    build_context,
    context_to_prompt_text,
    deterministic_fast_path,
)
from app.domain.macros import ActivityLevel, BiologicalSex, Goal, MacroTargets

router = APIRouter(prefix="/api/ai/coach", tags=["ai"])


class CoachMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class CoachMessageOut(BaseModel):
    role: str
    content: str
    created_at: str


def _load_context(db: SupabaseAdmin, user_id: str):
    profiles = db.select("profiles", {"id": f"eq.{user_id}", "select": "*"})
    if not profiles:
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    profile = profiles[0]

    weight_rows = db.select(
        "weight_logs",
        {"user_id": f"eq.{user_id}", "order": "logged_at.desc", "limit": "5"},
    )
    recent_weights = [w["weight_kg"] for w in reversed(weight_rows)]
    latest_weight = weight_rows[0]["weight_kg"] if weight_rows else profile.get("height_cm")

    today = datetime.now(timezone.utc).date()
    day_start = datetime.combine(today, time.min, tzinfo=timezone.utc)
    day_end = datetime.combine(today, time.max, tzinfo=timezone.utc)
    food_logs = db.select(
        "food_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lte.{day_end.isoformat()}"],
        },
    )
    consumed = {
        "calories": sum(f["calories"] for f in food_logs),
        "protein_g": sum(f["protein_g"] for f in food_logs),
        "carbs_g": sum(f["carbs_g"] for f in food_logs),
        "fat_g": sum(f["fat_g"] for f in food_logs),
    }

    target = MacroTargets(
        calories=profile["target_calories"],
        protein_g=profile["target_protein_g"],
        carbs_g=profile["target_carbs_g"],
        fat_g=profile["target_fat_g"],
    )

    return build_context(
        weight_kg=latest_weight or 70,
        height_cm=profile["height_cm"],
        sex=BiologicalSex(profile["sex"]),
        goal=Goal(profile["goal"]),
        target=target,
        consumed_calories=consumed["calories"],
        consumed_protein_g=consumed["protein_g"],
        consumed_carbs_g=consumed["carbs_g"],
        consumed_fat_g=consumed["fat_g"],
        recent_weights_kg=recent_weights,
    )


@router.get("/history", response_model=list[CoachMessageOut])
def get_history(current_user: CurrentUserDep) -> list[CoachMessageOut]:
    db = SupabaseAdmin()
    rows = db.select(
        "chat_history",
        {"user_id": f"eq.{current_user.user_id}", "order": "created_at.asc", "limit": "100"},
    )
    return [CoachMessageOut(role=r["role"], content=r["content"], created_at=r["created_at"]) for r in rows]


@router.post("/message", response_model=CoachMessageOut)
def send_message(payload: CoachMessageRequest, current_user: CurrentUserDep) -> CoachMessageOut:
    db = SupabaseAdmin()

    db.insert(
        "chat_history",
        {"user_id": current_user.user_id, "role": "user", "content": payload.message},
    )

    ctx = _load_context(db, current_user.user_id)

    fast_answer = deterministic_fast_path(payload.message, ctx)
    if fast_answer is not None:
        reply_text = fast_answer
        model_used = "deterministic"
    else:
        system_instruction = COACH_SYSTEM_INSTRUCTION.format(
            context=context_to_prompt_text(ctx)
        )
        try:
            reply_text = generate_text(
                payload.message, system_instruction=system_instruction, timeout=20
            )
        except GeminiUnavailable as exc:
            raise HTTPException(
                status_code=503, detail=f"Coach is temporarily unavailable: {exc}"
            )
        model_used = "gemini"

    row = db.insert(
        "chat_history",
        {
            "user_id": current_user.user_id,
            "role": "assistant",
            "content": reply_text,
            "model_used": model_used,
        },
    )[0]
    return CoachMessageOut(role="assistant", content=row["content"], created_at=row["created_at"])
