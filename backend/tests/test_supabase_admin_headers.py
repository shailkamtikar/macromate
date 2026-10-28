from app.core.supabase_admin import service_headers


def test_legacy_jwt_key_uses_apikey_and_bearer():
    headers = service_headers("eyJhbGciOi.payload.sig")
    assert headers["apikey"] == "eyJhbGciOi.payload.sig"
    assert headers["Authorization"] == "Bearer eyJhbGciOi.payload.sig"


def test_new_secret_key_is_sent_in_apikey_only():
    headers = service_headers("sb_secret_abc")
    assert headers["apikey"] == "sb_secret_abc"
    assert "Authorization" not in headers
