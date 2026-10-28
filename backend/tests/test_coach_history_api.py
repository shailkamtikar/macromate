"""GET /api/ai/coach/history returns the NEWEST messages (oldest first) and
pages backwards with `before` -- it used to return the oldest 100, so after
100 messages new ones never showed up on reload."""

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.supabase_admin import SupabaseAdmin, service_headers
from app.main import app

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.supabase_url or not settings.supabase_service_role_key,
    reason="Supabase credentials not configured",
)


@pytest.fixture
def user_with_chat():
    admin = service_headers(settings.supabase_service_role_key)
    email = f"macromate-history-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"
    created = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    user_id = created.json()["id"]
    signin = httpx.post(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_anon_key or settings.supabase_service_role_key},
        json={"email": email, "password": password},
        timeout=15,
    )
    db = SupabaseAdmin()
    start = datetime.now(timezone.utc) - timedelta(hours=2)
    rows = [
        {
            "user_id": user_id,
            "role": "user" if i % 2 == 0 else "assistant",
            "content": f"message {i}",
            "created_at": (start + timedelta(minutes=i)).isoformat(),
        }
        for i in range(120)
    ]
    for i in range(0, len(rows), 60):
        db.insert("chat_history", rows[i : i + 60])
    try:
        yield {"Authorization": f"Bearer {signin.json()['access_token']}"}
    finally:
        httpx.delete(f"{settings.supabase_url}/auth/v1/admin/users/{user_id}", headers=admin, timeout=15)


def test_history_shows_the_newest_messages_oldest_first(user_with_chat):
    client = TestClient(app)
    resp = client.get("/api/ai/coach/history", headers=user_with_chat)
    assert resp.status_code == 200
    messages = resp.json()
    assert len(messages) == 40
    assert messages[-1]["content"] == "message 119"  # newest is last
    assert messages[0]["content"] == "message 80"
    created = [m["created_at"] for m in messages]
    assert created == sorted(created)


def test_history_pages_backwards_with_before(user_with_chat):
    client = TestClient(app)
    first = client.get("/api/ai/coach/history", headers=user_with_chat).json()
    older = client.get(
        "/api/ai/coach/history", headers=user_with_chat, params={"before": first[0]["created_at"]}
    ).json()
    assert [m["content"] for m in older][-1] == "message 79"
    assert len(older) == 40
    nothing = client.get(
        "/api/ai/coach/history",
        headers=user_with_chat,
        params={"before": "2000-01-01T00:00:00+00:00"},
    ).json()
    assert nothing == []


def test_history_requires_authentication():
    assert TestClient(app).get("/api/ai/coach/history").status_code == 401
