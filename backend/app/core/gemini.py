"""Thin Gemini provider wrapper: primary model with automatic fallback,
timeout, and basic usage logging. This is the ONLY place in the backend
that calls Gemini — every AI feature goes through here so model selection,
fallback, and cost logging stay centralized (PRD §4.4).

Numeric/business-critical answers must never come from here: this module
returns text, and callers are responsible for treating it as language
output only, not as a source of truth for calculations.
"""

import logging
import time

import httpx

from app.core.config import get_settings

logger = logging.getLogger("macromate.gemini")

_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)


class GeminiError(Exception):
    pass


class GeminiUnavailable(GeminiError):
    """Raised when neither the primary nor fallback model could be reached —
    callers must handle this and degrade gracefully (e.g. fall back to a
    deterministic response), never silently fabricate an AI answer."""


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

    payload: dict = {"contents": _build_contents(prompt, history)}
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    started = time.monotonic()
    try:
        resp = httpx.post(
            _GENERATE_URL.format(model=model),
            params={"key": settings.gemini_api_key},
            json=payload,
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        # Network-level failures (timeout, connection reset, DNS, ...) must
        # also trigger fallback — not just non-200 HTTP responses.
        elapsed = time.monotonic() - started
        logger.warning(
            "gemini transport error model=%s elapsed=%.2fs error=%s", model, elapsed, exc
        )
        raise GeminiError(f"Gemini {model} request failed: {exc}") from exc
    elapsed = time.monotonic() - started

    if resp.status_code != 200:
        logger.warning(
            "gemini call failed model=%s status=%s elapsed=%.2fs", model, resp.status_code, elapsed
        )
        raise GeminiError(f"Gemini {model} returned {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as exc:
        raise GeminiError(f"Unexpected Gemini response shape: {data}") from exc

    usage = data.get("usageMetadata", {})
    logger.info(
        "gemini call ok model=%s elapsed=%.2fs prompt_tokens=%s output_tokens=%s",
        model,
        elapsed,
        usage.get("promptTokenCount"),
        usage.get("candidatesTokenCount"),
    )
    return text


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
) -> str:
    """Calls the primary model, automatically falling back to the
    lightweight model on any error (rate limit, timeout, outage).

    `history` is an optional bounded list of prior conversation turns
    (oldest first) included ahead of `prompt` for multi-turn context -- see
    `_build_contents`. `fallback_timeout` defaults to a shorter window than
    `timeout` (see DEFAULT_FALLBACK_TIMEOUT) so a slow/hung primary doesn't
    double the worst-case wait."""
    settings = get_settings()
    if fallback_timeout is None:
        fallback_timeout = min(timeout, DEFAULT_FALLBACK_TIMEOUT)
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
