
"""
LipiQ Multi-Provider AI Service

Providers:
- Gemini
- Groq
- OpenAI
- OpenRouter
- Ollama (optional local fallback)

Compatibility:
- generate(system_prompt, user_prompt, max_tokens=700)
- generate_ai(system_prompt, user_prompt, max_tokens=700)

Only extracted document text is sent to AI providers.
Original uploaded images are never sent by this module.
"""

import os
from dataclasses import dataclass
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

REQUEST_TIMEOUT_SECONDS = 60

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models"
OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434"


class AIUnavailableError(Exception):
    """Raised when no AI provider is configured."""


class AIRequestError(Exception):
    """Raised when all configured AI providers fail."""


@dataclass
class AIProvider:
    name: str
    model: str
    api_key: str = ""
    base_url: str = ""


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def get_providers() -> list[AIProvider]:
    """Return configured providers in the specified fallback order."""

    defaults = {
        "gemini": "gemini-3.8-flash",
        "groq": "llama-3.3-70b-versatile",
        "openai": "gpt-4.1-mini",
        "openrouter": "openrouter/auto",
        "ollama": "llama3.2",
    }

    order = _env(
        "AI_PROVIDER_ORDER",
        "groq,gemini,openai,openrouter,ollama",
    )

    providers = []

    for name in order.split(","):
        name = name.strip().lower()

        if name not in defaults:
            continue

        model = _env(
            f"{name.upper()}_MODEL",
            defaults[name],
        )

        if name == "gemini":
            key = _env("GEMINI_API_KEY")
            if key:
                providers.append(
                    AIProvider(name, model, key)
                )

        elif name == "groq":
            key = _env("GROQ_API_KEY")
            if key:
                providers.append(
                    AIProvider(name, model, key, GROQ_URL)
                )

        elif name == "openai":
            key = _env("OPENAI_API_KEY")
            if key:
                providers.append(
                    AIProvider(name, model, key, OPENAI_URL)
                )

        elif name == "openrouter":
            key = _env("OPENROUTER_API_KEY")
            if key:
                providers.append(
                    AIProvider(name, model, key, OPENROUTER_URL)
                )

        elif name == "ollama":
            base_url = _env(
                "OLLAMA_BASE_URL",
                OLLAMA_DEFAULT_URL,
            )
            providers.append(
                AIProvider(name, model, "", base_url)
            )

    return providers


def get_provider() -> AIProvider | None:
    """Return the first configured provider for backward compatibility."""
    providers = get_providers()
    return providers[0] if providers else None


def is_configured() -> bool:
    return bool(get_providers())


def _check_response(response, provider_name: str) -> None:
    """Raise a useful provider error for unsuccessful HTTP responses."""

    if response.ok:
        return

    status = response.status_code
    message = f"{provider_name} API error ({status})"

    if status in (401, 403):
        message += ": authentication or permission issue"
    elif status == 429:
        message += ": rate limit or quota exceeded"
    elif status >= 500:
        message += ": provider server error"
    else:
        message += f": {response.text[:500]}"

    raise AIRequestError(message)


def _openai_compatible_generate(
    provider: AIProvider,
    prompt: str,
    system_prompt: str,
    max_tokens: int,
) -> str:

    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }

    if provider.name == "openrouter":
        headers["HTTP-Referer"] = "https://lipiq.app"
        headers["X-Title"] = "LipiQ Kannada Document AI"

    payload = {
        "model": provider.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
    }

    response = requests.post(
        provider.base_url,
        headers=headers,
        json=payload,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )

    _check_response(response, provider.name)

    try:
        data = response.json()
        answer = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AIRequestError(
            f"{provider.name} returned an invalid response: {exc}"
        ) from exc

    if not isinstance(answer, str) or not answer.strip():
        raise AIRequestError(
            f"{provider.name} returned an empty response"
        )

    return answer.strip()


def _gemini_generate(
    provider: AIProvider,
    prompt: str,
    system_prompt: str,
    max_tokens: int,
) -> str:

    url = (
        f"{GEMINI_URL}/{provider.model}:generateContent"
        f"?key={provider.api_key}"
    )

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_tokens,
        },
    }

    response = requests.post(
        url,
        json=payload,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )

    _check_response(response, provider.name)

    try:
        data = response.json()
        answer = data["candidates"][0]["content"]["parts"][0]["text"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AIRequestError(
            f"Gemini returned an invalid response: {exc}"
        ) from exc

    if not isinstance(answer, str) or not answer.strip():
        raise AIRequestError("Gemini returned an empty response")

    return answer.strip()


def _gemini_vision_generate(
    provider: AIProvider,
    image_bytes: bytes,
    image_mime_type: str,
    user_prompt: str,
    system_prompt: str,
    max_tokens: int,
) -> str:
    """Generate text from an image using Gemini Vision.

    Accepts raw image bytes (already decoded by the caller) and sends them
    as an inline base64 data URI in the Gemini generateContent request.
    """
    import base64 as _base64

    image_data = _base64.b64encode(image_bytes).decode("utf-8")

    url = (
        f"{GEMINI_URL}/{provider.model}:generateContent"
        f"?key={provider.api_key}"
    )

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": user_prompt,
                    },
                    {
                        "inline_data": {
                            "mime_type": image_mime_type,
                            "data": image_data,
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_tokens,
        },
    }

    response = requests.post(
        url,
        json=payload,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )

    _check_response(response, provider.name)

    try:
        data = response.json()
        answer = data["candidates"][0]["content"]["parts"][0]["text"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AIRequestError(
            f"Gemini Vision returned an invalid response: {exc}"
        ) from exc

    if not isinstance(answer, str) or not answer.strip():
        raise AIRequestError("Gemini Vision returned an empty response")

    return answer.strip()


def _ollama_generate(
    provider: AIProvider,
    prompt: str,
    system_prompt: str,
    max_tokens: int,
) -> str:

    url = f"{provider.base_url.rstrip('/')}/api/chat"

    payload = {
        "model": provider.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "options": {
            "num_predict": max_tokens,
            "temperature": 0.2,
        },
    }

    response = requests.post(
        url,
        json=payload,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )

    _check_response(response, provider.name)

    try:
        data = response.json()
        answer = data["message"]["content"]
    except (ValueError, KeyError, TypeError) as exc:
        raise AIRequestError(
            f"Ollama returned an invalid response: {exc}"
        ) from exc

    if not isinstance(answer, str) or not answer.strip():
        raise AIRequestError("Ollama returned an empty response")

    return answer.strip()


def _generate_with_provider(
    provider: AIProvider,
    prompt: str,
    system_prompt: str,
    max_tokens: int,
) -> str:

    if provider.name == "gemini":
        return _gemini_generate(
            provider, prompt, system_prompt, max_tokens
        )

    if provider.name == "ollama":
        return _ollama_generate(
            provider, prompt, system_prompt, max_tokens
        )

    return _openai_compatible_generate(
        provider, prompt, system_prompt, max_tokens
    )


def generate(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 700,
) -> dict[str, Any]:
    """
    Generate text using configured providers.

    Tries providers in order and automatically falls back
    when a provider request fails.
    """

    if not isinstance(max_tokens, int) or max_tokens < 1:
        raise ValueError("max_tokens must be a positive integer")

    providers = get_providers()

    if not providers:
        raise AIUnavailableError(
            "No AI provider configured. Add an API key to .env."
        )

    errors = []

    for provider in providers:
        try:
            answer = _generate_with_provider(
                provider,
                user_prompt,
                system_prompt,
                max_tokens,
            )

            return {
                "answer": answer,
                "provider": provider.name,
                "model": provider.model,
            }

        except (requests.RequestException, AIRequestError, ValueError) as exc:
            errors.append(
                f"{provider.name}: {str(exc)[:300]}"
            )
            continue

        except Exception as exc:
            errors.append(
                f"{provider.name}: unexpected error: {str(exc)[:300]}"
            )
            continue

    raise AIRequestError(
        "All configured AI providers failed. "
        + " | ".join(errors)
    )


def generate_ai(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 700,
) -> dict[str, Any]:
    """Compatibility wrapper used by existing LipiQ backend endpoints."""

    return generate(
        system_prompt,
        user_prompt,
        max_tokens=max_tokens,
    )
