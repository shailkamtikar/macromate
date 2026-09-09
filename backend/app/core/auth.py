"""Verifies Supabase Auth (GoTrue) access tokens on protected routes.

Auth itself is handled entirely by Supabase on the frontend (supabase-js
signUp/signInWithPassword) — this module never issues or stores credentials,
it only verifies the JWT a client presents, via the project's public JWKS
endpoint (asymmetric ES256 keys, no shared secret involved).
"""

from typing import Annotated

import jwt
from cachetools import TTLCache
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.core.config import get_settings

_bearer_scheme = HTTPBearer(auto_error=False)

# PyJWKClient does its own internal caching of the key set, but we also
# cache the client instance itself per Supabase URL so repeated requests
# don't re-parse the JWKS response.
_jwk_client_cache: TTLCache = TTLCache(maxsize=4, ttl=3600)


def _get_jwk_client(supabase_url: str) -> PyJWKClient:
    if supabase_url not in _jwk_client_cache:
        _jwk_client_cache[supabase_url] = PyJWKClient(
            f"{supabase_url}/auth/v1/.well-known/jwks.json"
        )
    return _jwk_client_cache[supabase_url]


class CurrentUser:
    def __init__(self, user_id: str, email: str | None, claims: dict):
        self.user_id = user_id
        self.email = email
        self.claims = claims


def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ],
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization: Bearer <token> header",
        )

    settings = get_settings()
    if not settings.supabase_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_URL is not configured on the backend",
        )

    token = credentials.credentials
    try:
        jwk_client = _get_jwk_client(settings.supabase_url)
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
            # Absorbs minor clock drift between this machine and Supabase's
            # auth server (iat/nbf/exp are all sensitive to it).
            leeway=30,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        ) from exc

    return CurrentUser(
        user_id=claims["sub"], email=claims.get("email"), claims=claims
    )


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
