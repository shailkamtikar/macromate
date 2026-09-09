"""Server-side PostgREST client using the service-role key.

The service-role key bypasses RLS entirely — this module exists precisely
so that authorization is enforced once, explicitly, in application code
(scoping every query by the verified JWT's user id), rather than relying on
RLS a second time for server-issued requests. Never expose this key or a
client built from it to the frontend.
"""

import httpx

from app.core.config import get_settings


class SupabaseAdminError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(f"Supabase REST error {status_code}: {detail}")
        self.status_code = status_code
        self.detail = detail


class SupabaseAdmin:
    def __init__(self):
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError(
                "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured"
            )
        self._base_url = f"{settings.supabase_url}/rest/v1"
        self._headers = {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "Content-Type": "application/json",
        }

    def _request(
        self, method: str, path: str, *, params=None, json=None, prefer=None
    ) -> httpx.Response:
        headers = dict(self._headers)
        if prefer:
            headers["Prefer"] = prefer
        resp = httpx.request(
            method,
            f"{self._base_url}/{path}",
            headers=headers,
            params=params,
            json=json,
            timeout=15,
        )
        if resp.status_code >= 400:
            raise SupabaseAdminError(resp.status_code, resp.text)
        return resp

    def select(self, table: str, params: dict) -> list[dict]:
        return self._request("GET", table, params=params).json()

    def insert(self, table: str, data: dict, *, prefer="return=representation") -> list[dict]:
        return self._request(
            "POST", table, json=data, prefer=prefer
        ).json()

    def update(self, table: str, params: dict, data: dict) -> list[dict]:
        return self._request(
            "PATCH", table, params=params, json=data, prefer="return=representation"
        ).json()

    def rpc(self, function_name: str, args: dict) -> list[dict]:
        return self._request("POST", f"rpc/{function_name}", json=args).json()
