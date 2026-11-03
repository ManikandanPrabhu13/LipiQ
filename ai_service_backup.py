
"""
Optional AI helpers for LipiQ.

OCR works without an AI provider.
Supported providers:
  - Groq: GROQ_API_KEY
  - OpenRouter: OPENROUTER_API_KEY
  - Ollama: OLLAMA_MODEL

Only extracted text is sent to the configured provider.
Uploaded images are never sent by this module.
Secrets are read from environment variables and never logged.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434"
REQUEST_TIMEOUT_SECONDS = 60


class AIUnavailableError(RuntimeError):
    """No AI provider is configured."""


class AIRequestError(RuntimeError):
    """The configured provider failed or returned an unusable response."""


@dataclass(frozen=True)
class AIProvider:
    name: str
    model: str


def get_provider() -> AIProvider | None:
    """Return the configured provider without exposing credentials."""

    # Prefer Groq when its API key is available.
    if os.environ.get("GROQ_API_KEY"):
        return AIProvider(
            name="groq",
            model=os.environ.get(
                "GROQ_MODEL",
                "llama-3.3-70b-versatile",
            ),
        )

    if os.environ.get("OPENROUTER_API_KEY"):
        return AIProvider(
            name="openrouter",
            model=os.environ.get(
                "OPENROUTER_MODEL",
                "openrouter/auto",
            ),
        )

    if os.environ.get("OLLAMA_MODEL"):
        return AIProvider(
            name="ollama",
            model=os.environ["OLLAMA_MODEL"],
        )

    return None


def is_configured() -> bool:
    return get_provider() is not None


def _cloud_generate(
    url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int,
    provider_name: str,
) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    if provider_name == "openrouter":
        headers["X-Title"] = "LipiQ"

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": max_tokens,
    }

    try:
        response = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        raise AIRequestError(
            f"Could not reach {provider_name}."
        ) from error

    if response.status_code >= 400:
        # Do not expose API keys or raw provider responses to users.
        raise AIRequestError(
            f"{provider_name} returned HTTP {response.status_code}. "
            "Check the API key, model availability, and provider limits."
        )

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]

        if isinstance(content, str):
            return content.strip()

        raise TypeError("Unexpected response content type.")
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise AIRequestError(
            f"{provider_name} returned an unexpected response."
        ) from error


def _ollama_generate(
    provider: AIProvider,
    messages: list[dict[str, str]],
    max_tokens: int,
) -> str:
    base_url = os.environ.get(
        "OLLAMA_BASE_URL",
        OLLAMA_DEFAULT_URL,
    ).rstrip("/")

    payload = {
        "model": provider.model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": max_tokens,
        },
    }

    try:
        response = requests.post(
            f"{base_url}/api/chat",
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        raise AIRequestError(
            "Could not reach the local Ollama server."
        ) from error

    if response.status_code >= 400:
        raise AIRequestError(
            f"Ollama returned HTTP {response.status_code}."
        )

    try:
        data = response.json()
        return str(data["message"]["content"]).strip()
    except (ValueError, KeyError, TypeError) as error:
        raise AIRequestError(
            "Ollama returned an unexpected response."
        ) from error


def generate(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 700,
) -> dict[str, Any]:
    """Generate text and return the answer with provider/model details."""

    provider = get_provider()

    if provider is None:
        raise AIUnavailableError(
            "AI features are not configured. Set GROQ_API_KEY, "
            "OPENROUTER_API_KEY, or OLLAMA_MODEL, then restart the API. "
            "OCR continues to work without AI."
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    if provider.name == "groq":
        answer = _cloud_generate(
            GROQ_URL,
            os.environ["GROQ_API_KEY"],
            provider.model,
            messages,
            max_tokens,
            "groq",
        )
    elif provider.name == "openrouter":
        answer = _cloud_generate(
            OPENROUTER_URL,
            os.environ["OPENROUTER_API_KEY"],
            provider.model,
            messages,
            max_tokens,
            "openrouter",
        )
    else:
        answer = _ollama_generate(
            provider,
            messages,
            max_tokens,
        )

    if not answer:
        raise AIRequestError(
            "The AI provider returned an empty answer."
        )

    return {
        "answer": answer,
        "provider": provider.name,
        "model": provider.model,
    }
