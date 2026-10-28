"""Thin Gemini provider wrapper: primary model with automatic fallback,
timeout, per-user quota, and usage logging. This is the ONLY place in the
backend that calls Gemini — every AI feature goes through here so model
selection, fallback, quota and cost logging stay centralized (PRD §4.4).

Numeric/business-critical answers must never come from here: this module
returns text, and callers are responsible for treating it as language
output only, not as a source of truth for calculations.

Security notes: the API key travels in the `x-goog-api-key` header (never the
URL, which ends up in proxy/access logs), and upstream error bodies are only
logged -- exceptions raised from here carry no provider response text that a
router could echo to a browser.
"""

import logging
import threading
import time

import httpx

from app.core import quota
from app.core.config import get_settings

logger = logging.getLogger("macromate.gemini")

_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)


class GeminiError(Exception):
    pass


class GeminiBusy(GeminiError):
    """Too many Gemini calls are already in flight. Raised quickly (instead of
    queueing for ~30 s) so a burst of slow AI requests can never occupy every
    worker thread and starve the plain data endpoints."""


class GeminiUnavailable(GeminiError):
    """Raised when neither the primary nor fallback model could be reached —
    callers must handle this and degrade gracefully (e.g. fall back to a
    deterministic response), never silently fabricate an AI answer."""


QuotaExceeded = quota.QuotaExceeded

# Per-call options and usage are passed through thread-local state rather
# than extra keyword arguments so `_call_model`'s signature (which tests fake)
# stays stable. Handlers are synchronous, so one call == one thread.
_local = threading.local()


def _build_contents(prompt: str, history: list[dict] | None) -> list[dict]:
    """Turns a bounded list of prior conversation turns (each
    `{"role": "user"|"assistant", "content": str}`, oldest first) plus the
    new prompt into Gemini's multi-turn `contents` shape. Gemini only knows
    "user"/"model" roles, so "assistant" is mapped to "model" here."""
    contents = []
    for turn in history or []:
        role = "model" if turn["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": turn["content"]}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})
    return contents


def _generation_config(json_mode: bool, thinking_budget: int | None, *, with_thinking: bool) -> dict:
    config: dict = {"temperature": 0.2}
    if json_mode:
        # Native structured output: the model is constrained to emit valid
        # JSON, so we no longer depend on prompt wording + fence stripping.
        config["responseMimeType"] = "application/json"
    if with_thinking and thinking_budget is not None:
        # Short parsing/intent tasks gain nothing from long hidden
        # "thinking", which only adds seconds of latency and token cost.
        config["thinkingConfig"] = {"thinkingBudget": thinking_budget}
    return config


def _post(model: str, payload: dict, timeout: float) -> httpx.Response:
    settings = get_settings()
    return httpx.post(
        _GENERATE_URL.format(model=model),
        headers={"x-goog-api-key": settings.gemini_api_key},
        json=payload,
        timeout=timeout,
    )


def _call_model(
    model: str,
    prompt: str,
    *,
    system_instruction: str | None,
    timeout: float,
    history: list[dict] | None = None,
) -> str:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise GeminiUnavailable("GEMINI_API_KEY is not configured")

    options = getattr(_local, "options", {})
    json_mode = options.get("json_mode", False)
    thinking_budget = options.get("thinking_budget")

    payload: dict = {
        "contents": _build_contents(prompt, history),
        "generationConfig": _generation_config(json_mode, thinking_budget, with_thinking=True),
    }
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    started = time.monotonic()
    try:
        resp = _post(model, payload, timeout)
        if resp.status_code == 400 and "thinkingConfig" in payload["generationConfig"]:
            # Not every model accepts the thinking option (the lighter
            # fallback model answers a bare "invalid argument") -- retry once
            # without it rather than failing the whole request.
            payload["generationConfig"] = _generation_config(
                json_mode, thinking_budget, with_thinking=False
            )
            resp = _post(model, payload, timeout)
    except httpx.HTTPError as exc:
        # Network-level failures (timeout, connection reset, DNS, ...) must
        # also trigger fallback — not just non-200 HTTP responses.
        elapsed = time.monotonic() - started
        logger.warning(
            "gemini transport error model=%s elapsed=%.2fs error=%s",
            model,
            elapsed,
            type(exc).__name__,
        )
        raise GeminiError(f"Gemini {model} transport error") from exc
    elapsed = time.monotonic() - started

    if resp.status_code != 200:
        # The body is logged for developers but deliberately kept out of the
        # exception message so it can never reach an end user.
        logger.warning(
            "gemini call failed model=%s status=%s elapsed=%.2fs body=%s",
            model,
            resp.status_code,
            elapsed,
            resp.text[:300],
        )
        raise GeminiError(f"Gemini {model} returned {resp.status_code}")

    data = resp.json()
    candidates = data.get("candidates") or []
    candidate = candidates[0] if candidates else {}
    parts = (candidate.get("content") or {}).get("parts") or []
    text = parts[0].get("text") if parts else None
    if not text:
        # Blocked by a safety filter, truncated before any text, or an empty
        # candidate list: treat as a failed attempt so the fallback model
        # gets a turn, instead of crashing on a missing key.
        logger.warning(
            "gemini returned no text model=%s finishReason=%s promptFeedback=%s",
            model,
            candidate.get("finishReason"),
            data.get("promptFeedback"),
        )
        raise GeminiError(f"Gemini {model} returned no usable text")

    usage = data.get("usageMetadata", {})
    _local.usage = {
        "model": model,
        "prompt_tokens": usage.get("promptTokenCount"),
        "output_tokens": usage.get("candidatesTokenCount"),
        "latency_ms": int(elapsed * 1000),
    }
    logger.info(
        "gemini call ok model=%s elapsed=%.2fs prompt_tokens=%s output_tokens=%s",
        model,
        elapsed,
        usage.get("promptTokenCount"),
        usage.get("candidatesTokenCount"),
    )
    return text


# Handlers are synchronous and run on FastAPI's small thread pool; each
# Gemini call can hold a thread for ~30 s. Capping concurrent AI calls keeps
# threads free for ordinary data requests.
_ai_slots = threading.BoundedSemaphore(get_settings().ai_max_concurrency)
_SLOT_WAIT_SECONDS = 2.0

# The fallback only runs after the primary has already failed/timed out --
# giving it the same generous timeout as the primary would let a hung
# primary plus a hung fallback add up to ~2x `timeout` worst-case latency.
# A shorter fallback timeout keeps worst-case latency close to a single
# `timeout` window while still giving the (already lighter-weight) fallback
# model a fair chance to respond.
DEFAULT_FALLBACK_TIMEOUT = 8.0


def generate_text(
    prompt: str,
    *,
    system_instruction: str | None = None,
    history: list[dict] | None = None,
    timeout: float = 20.0,
    fallback_timeout: float | None = None,
    json_mode: bool = False,
    thinking_budget: int | None = 0,
    user_id: str | None = None,
    route: str = "",
) -> str:
    """Calls the primary model, automatically falling back to the
    lightweight model on any error (rate limit, timeout, outage).

    `history` is an optional bounded list of prior conversation turns
    (oldest first) included ahead of `prompt` for multi-turn context.
    `json_mode` asks Gemini for guaranteed-valid JSON. `thinking_budget`
    (tokens, 0 = off, None = model default) trades reasoning depth for speed.
    When `user_id` is given the per-user quota is enforced first (raises
    `QuotaExceeded`) and the call is recorded in `ai_usage` under `route`."""
    settings = get_settings()
    if fallback_timeout is None:
        fallback_timeout = min(timeout, DEFAULT_FALLBACK_TIMEOUT)

    if user_id is not None:
        quota.check_and_reserve(user_id)

    if not _ai_slots.acquire(timeout=_SLOT_WAIT_SECONDS):
        raise GeminiUnavailable("AI is busy right now, please try again in a moment")
    _local.options = {"json_mode": json_mode, "thinking_budget": thinking_budget}
    _local.usage = None
    try:
        text = _generate_with_fallback(
            prompt,
            system_instruction=system_instruction,
            history=history,
            timeout=timeout,
            fallback_timeout=fallback_timeout,
        )
        if user_id is not None:
            quota.record_usage(user_id, route, _local.usage, success=True)
        return text
    except GeminiError:
        if user_id is not None:
            quota.record_usage(user_id, route, None, success=False)
        raise
    finally:
        _ai_slots.release()
        _local.options = {}


def _generate_with_fallback(
    prompt: str,
    *,
    system_instruction: str | None,
    history: list[dict] | None,
    timeout: float,
    fallback_timeout: float,
) -> str:
    settings = get_settings()
    try:
        return _call_model(
            settings.gemini_primary_model,
            prompt,
            system_instruction=system_instruction,
            history=history,
            timeout=timeout,
        )
    except GeminiError as primary_error:
        logger.warning("primary Gemini model failed, falling back: %s", primary_error)
        try:
            return _call_model(
                settings.gemini_fallback_model,
                prompt,
                system_instruction=system_instruction,
                history=history,
                timeout=fallback_timeout,
            )
        except GeminiError as fallback_error:
            raise GeminiUnavailable(
                f"Both Gemini models failed. primary={primary_error} fallback={fallback_error}"
            ) from fallback_error
