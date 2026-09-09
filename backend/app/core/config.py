from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App configuration, loaded from environment variables / backend/.env.

    Fields are optional at import time so the app can boot (health checks,
    deterministic-logic endpoints, tests) before external services are
    provisioned. Endpoints that need a given integration must check for it
    explicitly and fail loudly, rather than silently degrading to fake data.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"

    supabase_url: str | None = None
    supabase_service_role_key: str | None = None

    gemini_api_key: str | None = None
    gemini_primary_model: str = "gemini-3.6-flash"
    gemini_fallback_model: str = "gemini-3.5-flash-lite"

    fcm_server_key: str | None = None

    cors_allow_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
