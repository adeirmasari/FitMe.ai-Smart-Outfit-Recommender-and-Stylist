"""Qwen2.5-VL adapter over the OpenAI-compatible chat-completions protocol.

This one adapter covers the common ways of serving Qwen2.5-VL:
  * Alibaba Cloud Model Studio / DashScope compatible mode
      QWEN_API_BASE=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
      QWEN_MODEL=qwen2.5-vl-72b-instruct
  * Self-hosted vLLM / SGLang / LMDeploy
      QWEN_API_BASE=http://gpu-host:8000/v1  QWEN_MODEL=Qwen/Qwen2.5-VL-7B-Instruct
  * OpenRouter
      QWEN_API_BASE=https://openrouter.ai/api/v1  QWEN_MODEL=qwen/qwen2.5-vl-72b-instruct
  * Ollama  QWEN_API_BASE=http://localhost:11434/v1  QWEN_MODEL=qwen2.5vl:7b
"""

import base64
import logging
import time

import requests
from django.conf import settings

from .base import (
    InvalidModelOutput,
    ProviderNotConfigured,
    ProviderRejected,
    ProviderResult,
    ProviderTimeout,
    ProviderUnavailable,
    VisionProvider,
)
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, build_user_prompt
from .schema import parse_model_text

logger = logging.getLogger(__name__)

MAX_RESPONSE_BYTES = 256 * 1024
_TRANSIENT_STATUS = {429, 500, 502, 503, 504}


class QwenVLProvider(VisionProvider):
    name = "qwen"
    is_mock = False

    def __init__(self, config=None, session=None):
        self.config = dict(config or settings.QWEN)
        self.model = self.config["MODEL"]
        self.session = session or requests.Session()

    def is_configured(self):
        return bool(self.config.get("API_BASE") and self.config.get("MODEL"))

    def _payload(self, request):
        image_b64 = base64.b64encode(request.image_bytes).decode("ascii")
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{request.image_mime};base64,{image_b64}"}},
                        {"type": "text", "text": build_user_prompt(request)},
                    ],
                },
            ],
            "max_tokens": self.config["MAX_TOKENS"],
            "temperature": self.config["TEMPERATURE"],
            "top_p": self.config["TOP_P"],
        }
        if self.config.get("JSON_MODE"):
            payload["response_format"] = {"type": "json_object"}
        return payload

    def _headers(self):
        headers = {"Content-Type": "application/json"}
        if self.config.get("API_KEY"):
            headers["Authorization"] = f"Bearer {self.config['API_KEY']}"
        return headers

    def _post(self, payload):
        url = f"{self.config['API_BASE']}/chat/completions"
        timeout = (self.config["CONNECT_TIMEOUT_SECONDS"], self.config["TIMEOUT_SECONDS"])
        attempts = 1 + max(0, int(self.config.get("MAX_RETRIES", 0)))
        last_error = None
        for attempt in range(attempts):
            try:
                response = self.session.post(url, json=payload, headers=self._headers(), timeout=timeout)
            except requests.Timeout as exc:
                # Not retried: a second full timeout would double the user's wait.
                raise ProviderTimeout("provider timed out") from exc
            except requests.RequestException as exc:
                last_error = ProviderUnavailable(f"connection error: {type(exc).__name__}")
            else:
                if response.status_code < 400:
                    return response
                logger.warning("Qwen provider HTTP %s (attempt %s/%s)", response.status_code, attempt + 1, attempts)
                if response.status_code in _TRANSIENT_STATUS:
                    last_error = ProviderUnavailable(f"HTTP {response.status_code}")
                elif response.status_code in (401, 403, 404):
                    # Credentials or model id wrong: an operator problem, not the user's.
                    raise ProviderNotConfigured(f"HTTP {response.status_code}")
                else:
                    raise ProviderRejected(f"HTTP {response.status_code}")
            if attempt + 1 < attempts:
                time.sleep(min(2.0, 0.5 * (attempt + 1)))
        raise last_error

    def analyze(self, request):
        if not self.is_configured():
            raise ProviderNotConfigured("QWEN_API_BASE / QWEN_MODEL not set")

        started = time.monotonic()
        response = self._post(self._payload(request))
        latency_ms = int((time.monotonic() - started) * 1000)

        if len(response.content) > MAX_RESPONSE_BYTES:
            raise InvalidModelOutput("provider response too large")
        try:
            body = response.json()
            choice = body["choices"][0]
            text = choice["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise InvalidModelOutput("unexpected provider response shape") from exc
        if isinstance(text, list):  # some servers return content parts
            text = "".join(part.get("text", "") for part in text if isinstance(part, dict))

        data = parse_model_text(text)
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        return ProviderResult(
            data=data,
            provider=self.name,
            model=str(body.get("model") or self.model)[:120],
            is_mock=False,
            latency_ms=latency_ms,
            prompt_version=PROMPT_VERSION,
            metadata={
                "finish_reason": choice.get("finish_reason"),
                "usage": {k: usage.get(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens") if k in usage},
                "request_id": str(body.get("id", ""))[:120],
            },
        )
