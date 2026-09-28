from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin, SupabaseAdminError
from app.domain.achievements import STREAK_LOOKBACK_DAYS, calculate_logging_streak
from app.domain.friends import compute_discipline_score, rank_leaderboard
from app.domain.progress import week_bounds
from app.domain.timeutil import day_bounds_utc, local_today, utc_timestamp_to_local_date

router = APIRouter(prefix="/api/friends", tags=["friends"])

# Friend meal activity is intentionally a short, recent window -- a
# lightweight "what's happening" glance, not a social feed history.
ACTIVITY_LOOKBACK_DAYS = 2
MAX_ACTIVITY_ITEMS = 20


def _accepted_friend_ids(db: SupabaseAdmin, user_id: str) -> set[str]:
    as_requester = db.select(
        "friendships",
        {"requester_id": f"eq.{user_id}", "status": "eq.accepted", "select": "addressee_id"},
    )
    as_addressee = db.select(
        "friendships",
        {"addressee_id": f"eq.{user_id}", "status": "eq.accepted", "select": "requester_id"},
    )
    return {r["addressee_id"] for r in as_requester} | {r["requester_id"] for r in as_addressee}


class UserSearchResult(BaseModel):
    id: str
    username: str


class FriendRequestIn(BaseModel):
    username: str = Field(min_length=1, max_length=50)


class FriendshipOut(BaseModel):
    id: str
    status: str
    requester_id: str
    addressee_id: str
    other_username: str


class RespondRequest(BaseModel):
    accept: bool


class LeaderboardEntry(BaseModel):
    user_id: str
    username: str
    discipline_score: int
    days_logged: int
    is_self: bool
    current_streak_days: int


class FriendActivityItem(BaseModel):
    user_id: str
    username: str
    meal_type: str
    # Latest log time within this grouped activity item (ISO 8601) -- the
    # only timing info exposed. Never calories, macros, food names, or
    # quantities: friend activity is a presence signal, not a data feed.
    logged_at: str
    item_count: int


@router.get("/search", response_model=list[UserSearchResult])
def search_users(current_user: CurrentUserDep, q: str = Query(min_length=1, max_length=50)) -> list[UserSearchResult]:
    db = SupabaseAdmin()
    rows = db.select(
        "profiles",
        {"username": f"ilike.*{q}*", "select": "id,username", "limit": "10"},
    )
    return [UserSearchResult(**r) for r in rows if r["id"] != current_user.user_id]


@router.post("/request", response_model=FriendshipOut)
def send_friend_request(payload: FriendRequestIn, current_user: CurrentUserDep) -> FriendshipOut:
    db = SupabaseAdmin()
    matches = db.select("profiles", {"username": f"eq.{payload.username}", "select": "id,username"})
    if not matches:
        raise HTTPException(status_code=404, detail="No user with that username")
    addressee = matches[0]
    if addressee["id"] == current_user.user_id:
        raise HTTPException(status_code=400, detail="Can't friend yourself")

    try:
        row = db.insert(
            "friendships",
            {
                "requester_id": current_user.user_id,
                "addressee_id": addressee["id"],
                "status": "pending",
            },
        )[0]
    except SupabaseAdminError as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail="Friend request already exists")
        raise

    return FriendshipOut(
        id=row["id"],
        status=row["status"],
        requester_id=row["requester_id"],
        addressee_id=row["addressee_id"],
        other_username=addressee["username"],
    )


@router.get("", response_model=list[FriendshipOut])
def list_friendships(current_user: CurrentUserDep) -> list[FriendshipOut]:
    db = SupabaseAdmin()
    as_requester = db.select(
        "friendships", {"requester_id": f"eq.{current_user.user_id}", "select": "*"}
    )
    as_addressee = db.select(
        "friendships", {"addressee_id": f"eq.{current_user.user_id}", "select": "*"}
    )
    all_rows = as_requester + as_addressee

    other_ids = {
        (r["addressee_id"] if r["requester_id"] == current_user.user_id else r["requester_id"])
        for r in all_rows
    }
    usernames: dict[str, str] = {}
    if other_ids:
        id_filter = "(" + ",".join(other_ids) + ")"
        for row in db.select("profiles", {"id": f"in.{id_filter}", "select": "id,username"}):
            usernames[row["id"]] = row["username"]

    return [
        FriendshipOut(
            id=r["id"],
            status=r["status"],
            requester_id=r["requester_id"],
            addressee_id=r["addressee_id"],
            other_username=usernames.get(
                r["addressee_id"] if r["requester_id"] == current_user.user_id else r["requester_id"],
                "unknown",
            ),
        )
        for r in all_rows
    ]


@router.post("/{friendship_id}/respond", response_model=FriendshipOut)
def respond_to_request(
    friendship_id: str, payload: RespondRequest, current_user: CurrentUserDep
) -> FriendshipOut:
    db = SupabaseAdmin()
    matches = db.select("friendships", {"id": f"eq.{friendship_id}", "select": "*"})
    if not matches:
        raise HTTPException(status_code=404, detail="Not found")
    friendship = matches[0]
    # Only the addressee may accept/decline — never trust that the client
    # calling this is authorized just because it has the id.
    if friendship["addressee_id"] != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not your request to respond to")

    new_status = "accepted" if payload.accept else "declined"
    updated = db.update("friendships", {"id": f"eq.{friendship_id}"}, {"status": new_status})[0]

    addressee_profile = db.select(
        "profiles", {"id": f"eq.{updated['requester_id']}", "select": "username"}
    )
    return FriendshipOut(
        id=updated["id"],
        status=updated["status"],
        requester_id=updated["requester_id"],
        addressee_id=updated["addressee_id"],
        other_username=addressee_profile[0]["username"] if addressee_profile else "unknown",
    )


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def get_leaderboard(current_user: CurrentUserDep) -> list[LeaderboardEntry]:
    db = SupabaseAdmin()

    friend_ids = _accepted_friend_ids(db, current_user.user_id)
    friend_ids.add(current_user.user_id)

    id_filter = "(" + ",".join(friend_ids) + ")"
    profiles = db.select(
        "profiles",
        {"id": f"in.{id_filter}", "select": "id,username,target_calories,leaderboard_visible,timezone"},
    )
    # Only self + friends who've opted in are ever included — never expose
    # a friend who has leaderboard_visible = false.
    visible_profiles = [p for p in profiles if p["id"] == current_user.user_id or p["leaderboard_visible"]]

    scores = []
    streaks: dict[str, int] = {}
    for profile in visible_profiles:
        # Every friend's own local calendar (timezone, "today", and the
        # current week) drives their bucketing -- never the requesting
        # user's timezone, or a friend in a different timezone gets logs
        # dropped or bucketed onto the wrong local day.
        friend_tz = profile.get("timezone") or "UTC"
        friend_today = local_today(friend_tz)
        friend_week_start, _ = week_bounds(friend_today)
        start, _ = day_bounds_utc(friend_week_start, friend_tz)
        _, end = day_bounds_utc(friend_week_start + timedelta(days=6), friend_tz)
        # The leaderboard always reflects the current, still-in-progress
        # week -- so the adherence-percentage denominator must be the
        # number of days that have actually happened so far this week for
        # THIS friend, not a full 7, or early-week scores read as near-zero.
        days_in_period = max(1, min(7, (friend_today - friend_week_start).days + 1))
        streak_start, _ = day_bounds_utc(
            friend_today - timedelta(days=STREAK_LOOKBACK_DAYS), friend_tz
        )

        logs = db.select(
            "food_logs",
            {
                "user_id": f"eq.{profile['id']}",
                "logged_at": [f"gte.{start.isoformat()}", f"lt.{end.isoformat()}"],
            },
        )
        scores.append(
            compute_discipline_score(
                user_id=profile["id"],
                username=profile["username"],
                food_logs=logs,
                week_start=friend_week_start,
                target_calories=profile["target_calories"],
                is_self=profile["id"] == current_user.user_id,
                tz_name=friend_tz,
                days_in_period=days_in_period,
            )
        )

        # A separate, narrow (logged_at only) query over the longer streak
        # lookback -- kept independent of the 7-day discipline-score query
        # above so neither computation risks the other's correctness.
        streak_logs = db.select(
            "food_logs",
            {
                "user_id": f"eq.{profile['id']}",
                "logged_at": f"gte.{streak_start.isoformat()}",
                "select": "logged_at",
            },
        )
        logged_dates = {
            utc_timestamp_to_local_date(row["logged_at"], friend_tz) for row in streak_logs
        }
        streaks[profile["id"]] = calculate_logging_streak(logged_dates, friend_today)

    ranked = rank_leaderboard(scores)
    return [
        LeaderboardEntry(
            user_id=s.user_id,
            username=s.username,
            discipline_score=s.discipline_score,
            days_logged=s.days_logged,
            is_self=s.is_self,
            current_streak_days=streaks.get(s.user_id, 0),
        )
        for s in ranked
    ]


@router.get("/activity", response_model=list[FriendActivityItem])
def get_friend_activity(current_user: CurrentUserDep) -> list[FriendActivityItem]:
    """A lightweight "what's happening" glance at accepted friends' recent
    meal logging -- never their calories, macros, or which foods they ate.
    One activity item per (friend, meal, day), regardless of how many
    individual foods were logged in that meal."""
    db = SupabaseAdmin()

    friend_ids = _accepted_friend_ids(db, current_user.user_id)
    if not friend_ids:
        return []

    id_filter = "(" + ",".join(friend_ids) + ")"
    profiles = db.select(
        "profiles",
        {"id": f"in.{id_filter}", "select": "id,username,timezone,leaderboard_visible"},
    )
    # Reuses the same opt-out flag as the leaderboard -- a friend who has
    # opted out of being visible there is also never surfaced in activity.
    visible = {p["id"]: p for p in profiles if p["leaderboard_visible"]}
    if not visible:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=ACTIVITY_LOOKBACK_DAYS)
    vis_id_filter = "(" + ",".join(visible.keys()) + ")"
    logs = db.select(
        "food_logs",
        {
            "user_id": f"in.{vis_id_filter}",
            "logged_at": f"gte.{cutoff.isoformat()}",
            # Only enough to group and label the activity -- never the
            # nutrition snapshot or which food was logged.
            "select": "user_id,meal_type,logged_at",
            "order": "logged_at.desc",
        },
    )

    groups: dict[tuple[str, str, object], dict] = {}
    for log in logs:
        profile = visible[log["user_id"]]
        day = utc_timestamp_to_local_date(log["logged_at"], profile.get("timezone") or "UTC")
        key = (log["user_id"], log["meal_type"], day)
        group = groups.get(key)
        if group is None:
            # `logs` is already newest-first, so the first log seen for a
            # given group is necessarily its most recent one.
            groups[key] = {"count": 1, "latest": log["logged_at"]}
        else:
            group["count"] += 1

    items = [
        FriendActivityItem(
            user_id=user_id,
            username=visible[user_id]["username"],
            meal_type=meal_type,
            logged_at=group["latest"],
            item_count=group["count"],
        )
        for (user_id, meal_type, _day), group in groups.items()
    ]
    items.sort(key=lambda i: i.logged_at, reverse=True)
    return items[:MAX_ACTIVITY_ITEMS]
