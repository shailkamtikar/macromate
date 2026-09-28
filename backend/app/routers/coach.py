from dataclasses import replace
from datetime import timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.gemini import GeminiUnavailable, generate_text
from app.core.supabase_admin import SupabaseAdmin
from app.domain.coach import build_context, context_to_prompt_text, deterministic_fast_path
from app.domain.coach_actions import execute_add_food, execute_log_water, execute_remove_food
from app.domain.coach_intent import COACH_INTENT_SYSTEM_INSTRUCTION, CoachIntent, parse_coach_intent
from app.domain.macros import BiologicalSex, Goal, MacroTargets
from app.domain.progress import build_weekly_report, week_bounds
from app.domain.timeutil import day_bounds_utc, infer_meal_type, local_today

router = APIRouter(prefix="/api/ai/coach", tags=["ai"])

# Bounded conversational memory: enough recent turns for natural follow-ups
# ("what about carbs?") without ever sending a user's entire lifetime chat
# history to Gemini on every message.
COACH_HISTORY_TURN_LIMIT = 12
# A hung/slow fallback call should still return well within a normal
# request budget -- shorter than the primary's timeout (see
# app/core/gemini.py's DEFAULT_FALLBACK_TIMEOUT for the rationale).
COACH_FALLBACK_TIMEOUT = 8.0

# A fixed, backend-owned refusal -- never Gemini's own words for this case,
# so an out-of-scope request can never accidentally be answered anyway
# (e.g. if the model decided to help despite being told not to).
OUT_OF_SCOPE_REPLY = (
    "I'm here for fitness, nutrition, health, and your MacroMate goals. "
    "I can't help with programming or unrelated tasks."
)


class CoachMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class CoachMessageOut(BaseModel):
    role: str
    content: str
    created_at: str
    # Only ever set on the direct response to the message that triggered
    # it (never on history replay) -- lets the frontend show a lightweight
    # "View in Today" link when an action actually changed the user's
    # data. None whenever no mutation happened.
    action: str | None = None


def _load_context(db: SupabaseAdmin, user_id: str, *, include_weekly_summary: bool = True):
    """Builds the deterministic MacroMate facts Coach ever states.

    `include_weekly_summary=False` skips `_weekly_summary`'s extra DB reads
    (two weekly food-log scans plus a weekly weight-log scan) -- callers
    that only need this to check `deterministic_fast_path` (which never
    reads `ctx.weekly_summary`) should pass this, since a fast-path answer
    doesn't need it and those reads would be wasted. The Gemini-backed path
    still gets the full summary via `_add_weekly_summary` below."""
    profiles = db.select("profiles", {"id": f"eq.{user_id}", "select": "*"})
    if not profiles:
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    profile = profiles[0]
    tz_name = profile.get("timezone") or "UTC"

    weight_rows = db.select(
        "weight_logs",
        {"user_id": f"eq.{user_id}", "order": "logged_at.desc", "limit": "5"},
    )
    recent_weights = [w["weight_kg"] for w in reversed(weight_rows)]
    latest_weight = weight_rows[0]["weight_kg"] if weight_rows else profile.get("height_cm")

    today = local_today(tz_name)
    day_start, day_end = day_bounds_utc(today, tz_name)
    food_logs = db.select(
        "food_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lt.{day_end.isoformat()}"],
            "select": "calories,protein_g,carbs_g,fat_g,food_items(name)",
        },
    )
    consumed = {
        "calories": sum(f["calories"] for f in food_logs),
        "protein_g": sum(f["protein_g"] for f in food_logs),
        "carbs_g": sum(f["carbs_g"] for f in food_logs),
        "fat_g": sum(f["fat_g"] for f in food_logs),
    }
    logged_food_names = [
        (f.get("food_items") or {}).get("name") for f in food_logs if f.get("food_items")
    ]

    water_rows = db.select(
        "water_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lt.{day_end.isoformat()}"],
        },
    )
    hydration_ml = sum(w["volume_ml"] for w in water_rows)

    activity_rows = db.select(
        "activity_logs", {"user_id": f"eq.{user_id}", "activity_date": f"eq.{today.isoformat()}"}
    )
    activity_steps_today = None
    if activity_rows and activity_rows[0].get("steps") is not None:
        activity_steps_today = activity_rows[0]["steps"]

    weekly_summary = (
        _weekly_summary(db, user_id, today, tz_name, profile["target_calories"])
        if include_weekly_summary
        else None
    )

    target = MacroTargets(
        calories=profile["target_calories"],
        protein_g=profile["target_protein_g"],
        carbs_g=profile["target_carbs_g"],
        fat_g=profile["target_fat_g"],
    )

    ctx = build_context(
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
        hydration_ml=hydration_ml,
        hydration_goal_ml=profile.get("water_goal_ml"),
        logged_food_names=logged_food_names[:8],
        weekly_summary=weekly_summary,
        activity_steps_today=activity_steps_today,
    )
    return profile, ctx


def _weekly_summary(db, user_id, today, tz_name, target_calories) -> str | None:
    """Best-effort: a missing/incomplete week (brand-new user) must never
    break an ordinary coach message, so any failure here just omits the
    line rather than surfacing an error."""
    try:
        current_week_start, _ = week_bounds(today)
        previous_week_start = current_week_start - timedelta(days=7)

        def week_logs(week_start):
            start, _ = day_bounds_utc(week_start, tz_name)
            _, end = day_bounds_utc(week_start + timedelta(days=6), tz_name)
            return db.select(
                "food_logs",
                {
                    "user_id": f"eq.{user_id}",
                    "logged_at": [f"gte.{start.isoformat()}", f"lt.{end.isoformat()}"],
                },
            )

        weight_start, _ = day_bounds_utc(current_week_start, tz_name)
        _, weight_end = day_bounds_utc(current_week_start + timedelta(days=6), tz_name)
        weight_rows = db.select(
            "weight_logs",
            {
                "user_id": f"eq.{user_id}",
                "logged_at": [f"gte.{weight_start.isoformat()}", f"lt.{weight_end.isoformat()}"],
            },
        )
        report = build_weekly_report(
            current_food_logs=week_logs(current_week_start),
            previous_food_logs=week_logs(previous_week_start),
            current_weight_logs=weight_rows,
            current_week_start=current_week_start,
            previous_week_start=previous_week_start,
            target_calories=target_calories,
            tz_name=tz_name,
        )
        if report.current.days_logged == 0:
            return None
        return (
            f"This week so far: hit protein goal {report.current.days_goal_hit}/"
            f"{report.current.days_logged} logged days (avg {report.current.avg_protein_g}g/day "
            f"protein), vs {report.previous.avg_protein_g}g/day last week"
        )
    except Exception:
        return None


def _add_weekly_summary(db: SupabaseAdmin, user_id: str, profile: dict, ctx):
    """Fills in `ctx.weekly_summary` for a context that was built with
    `include_weekly_summary=False` -- called only once a message is known
    to need the Gemini path, so the fast path never pays for these reads."""
    tz_name = profile.get("timezone") or "UTC"
    today = local_today(tz_name)
    summary = _weekly_summary(db, user_id, today, tz_name, profile["target_calories"])
    return replace(ctx, weekly_summary=summary)


@router.get("/history", response_model=list[CoachMessageOut])
def get_history(current_user: CurrentUserDep) -> list[CoachMessageOut]:
    db = SupabaseAdmin()
    rows = db.select(
        "chat_history",
        {"user_id": f"eq.{current_user.user_id}", "order": "created_at.asc", "limit": "100"},
    )
    return [CoachMessageOut(role=r["role"], content=r["content"], created_at=r["created_at"]) for r in rows]


def _load_recent_history(db: SupabaseAdmin, user_id: str, limit: int = COACH_HISTORY_TURN_LIMIT) -> list[dict]:
    """The last `limit` turns of this user's own conversation, oldest
    first -- bounded so a long-running conversation never grows the
    Gemini prompt indefinitely, and scoped strictly to `user_id` so one
    user's history can never leak into another user's Coach context."""
    rows = db.select(
        "chat_history",
        {"user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": str(limit)},
    )
    rows.reverse()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def _store_reply(
    db: SupabaseAdmin, user_id: str, content: str, model_used: str, *, action: str | None
) -> CoachMessageOut:
    row = db.insert(
        "chat_history",
        {"user_id": user_id, "role": "assistant", "content": content, "model_used": model_used},
    )[0]
    return CoachMessageOut(
        role="assistant", content=row["content"], created_at=row["created_at"], action=action
    )


@router.post("/message", response_model=CoachMessageOut)
def send_message(payload: CoachMessageRequest, current_user: CurrentUserDep) -> CoachMessageOut:
    db = SupabaseAdmin()
    user_id = current_user.user_id

    # Fetched before inserting the new user message below, so it never
    # includes that message twice -- `history` is prior turns only, and
    # `payload.message` is appended separately as the final turn.
    history = _load_recent_history(db, user_id)

    db.insert(
        "chat_history",
        {"user_id": user_id, "role": "user", "content": payload.message},
    )

    # Cheap context only (profile + today's numbers) -- enough to answer
    # deterministically or to check whether deterministic_fast_path even
    # applies, without yet paying for the weekly-summary reads that only
    # the Gemini path actually uses.
    profile, ctx = _load_context(db, user_id, include_weekly_summary=False)

    fast_answer = deterministic_fast_path(payload.message, ctx)
    if fast_answer is not None:
        return _store_reply(db, user_id, fast_answer, "deterministic", action=None)

    ctx = _add_weekly_summary(db, user_id, profile, ctx)

    system_instruction = COACH_INTENT_SYSTEM_INSTRUCTION.format(
        context=context_to_prompt_text(ctx)
    )
    try:
        raw_response = generate_text(
            payload.message,
            system_instruction=system_instruction,
            history=history,
            timeout=20,
            fallback_timeout=COACH_FALLBACK_TIMEOUT,
        )
    except GeminiUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Coach is temporarily unavailable: {exc}")

    try:
        intent = parse_coach_intent(raw_response)
    except ValueError:
        # Malformed structured output -- fail safe to an honest "couldn't
        # understand" reply rather than crashing or guessing at an action.
        return _store_reply(
            db,
            current_user.user_id,
            "Sorry, I had trouble understanding that — could you rephrase?",
            "gemini",
            action=None,
        )

    return _dispatch_intent(db, current_user, profile, intent)


def _dispatch_intent(db, current_user, profile, intent: CoachIntent) -> CoachMessageOut:
    user_id = current_user.user_id

    if not intent.in_scope:
        return _store_reply(db, user_id, OUT_OF_SCOPE_REPLY, "gemini", action=None)

    if intent.intent == "read":
        reply = intent.reply.strip() or "Could you rephrase that?"
        return _store_reply(db, user_id, reply, "gemini", action=None)

    if intent.needs_clarification:
        reply = intent.clarification_question or "Could you give me a bit more detail?"
        return _store_reply(db, user_id, reply, "gemini", action=None)

    if intent.intent == "add_food":
        if not intent.foods:
            return _store_reply(
                db, user_id, "I couldn't tell which food to add — could you rephrase?",
                "gemini", action=None,
            )
        meal_type = intent.meal_type or infer_meal_type(profile.get("timezone"))
        result = execute_add_food(db, user_id, intent.foods, meal_type)
        if not result.logged:
            return _store_reply(
                db, user_id,
                "I couldn't work out nutrition for that — could you describe it differently?",
                "gemini", action=None,
            )
        names = ", ".join(r.food_name for r in result.logged)
        reply = f"Added {names} to {meal_type.capitalize()} — {round(result.total_calories)} kcal total."
        return _store_reply(db, user_id, reply, "gemini", action="add_food")

    if intent.intent == "log_water":
        if not intent.water_ml:
            reply = intent.clarification_question or "How much water would you like to log?"
            return _store_reply(db, user_id, reply, "gemini", action=None)
        result = execute_log_water(db, user_id, intent.water_ml)
        reply = f"Logged {round(intent.water_ml)} ml of water — {round(result.total_ml)} ml today so far."
        return _store_reply(db, user_id, reply, "gemini", action="log_water")

    if intent.intent == "remove_food":
        if not intent.remove_description:
            reply = intent.clarification_question or "Which food would you like removed?"
            return _store_reply(db, user_id, reply, "gemini", action=None)
        result = execute_remove_food(db, user_id, intent.remove_description)
        if result.removed:
            return _store_reply(
                db, user_id, f"Removed {result.food_name} from today's diary.",
                "gemini", action="remove_food",
            )
        reply = (
            "I found more than one match for that today — could you be more specific, "
            "or remove it directly from Today?"
            if result.reason == "ambiguous"
            else "I couldn't find a matching food logged today to remove."
        )
        return _store_reply(db, user_id, reply, "gemini", action=None)

    # Unreachable given CoachIntent's Literal type, but never leave a
    # message unanswered.
    return _store_reply(db, user_id, intent.reply or "Could you rephrase that?", "gemini", action=None)
