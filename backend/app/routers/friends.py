from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin, SupabaseAdminError
from app.domain.friends import compute_discipline_score, rank_leaderboard
from app.domain.progress import week_bounds

router = APIRouter(prefix="/api/friends", tags=["friends"])


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

    as_requester = db.select(
        "friendships",
        {"requester_id": f"eq.{current_user.user_id}", "status": "eq.accepted", "select": "addressee_id"},
    )
    as_addressee = db.select(
        "friendships",
        {"addressee_id": f"eq.{current_user.user_id}", "status": "eq.accepted", "select": "requester_id"},
    )
    friend_ids = {r["addressee_id"] for r in as_requester} | {r["requester_id"] for r in as_addressee}
    friend_ids.add(current_user.user_id)

    id_filter = "(" + ",".join(friend_ids) + ")"
    profiles = db.select(
        "profiles",
        {"id": f"in.{id_filter}", "select": "id,username,target_calories,leaderboard_visible"},
    )
    # Only self + friends who've opted in are ever included — never expose
    # a friend who has leaderboard_visible = false.
    visible_profiles = [p for p in profiles if p["id"] == current_user.user_id or p["leaderboard_visible"]]

    week_start, _ = week_bounds(datetime.now(timezone.utc).date())
    start = datetime.combine(week_start, time.min, tzinfo=timezone.utc)
    end = datetime.combine(week_start + timedelta(days=6), time.max, tzinfo=timezone.utc)

    scores = []
    for profile in visible_profiles:
        logs = db.select(
            "food_logs",
            {
                "user_id": f"eq.{profile['id']}",
                "logged_at": [f"gte.{start.isoformat()}", f"lte.{end.isoformat()}"],
            },
        )
        scores.append(
            compute_discipline_score(
                user_id=profile["id"],
                username=profile["username"],
                food_logs=logs,
                week_start=week_start,
                target_calories=profile["target_calories"],
                is_self=profile["id"] == current_user.user_id,
            )
        )

    ranked = rank_leaderboard(scores)
    return [
        LeaderboardEntry(
            user_id=s.user_id,
            username=s.username,
            discipline_score=s.discipline_score,
            days_logged=s.days_logged,
            is_self=s.is_self,
        )
        for s in ranked
    ]
