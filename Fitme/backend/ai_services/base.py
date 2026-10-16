"""Provider-agnostic contracts for vision-language outfit analysis."""

from dataclasses import dataclass, field


class ProviderError(Exception):
    """Base class. `code` is stored on the analysis and shown to the user."""

    code = "provider_error"
    user_message = "The styling model could not complete this analysis. Please try again."
    retryable = True


class ProviderNotConfigured(ProviderError):
    code = "provider_not_configured"
    user_message = "Outfit analysis is not available right now because no AI provider is configured."
    retryable = False


class ProviderTimeout(ProviderError):
    code = "provider_timeout"
    user_message = "The styling model took too long to respond. Please try again in a moment."


class ProviderUnavailable(ProviderError):
    code = "provider_unavailable"
    user_message = "The styling model is temporarily unavailable. Please try again shortly."


class ProviderRejected(ProviderError):
    code = "provider_rejected"
    user_message = "The styling model rejected this request. Try a different photo."
    retryable = False


class InvalidModelOutput(ProviderError):
    code = "invalid_model_output"
    user_message = "The styling model returned an incomplete answer. Retrying usually fixes this."


@dataclass(frozen=True)
class AnalysisRequest:
    image_bytes: bytes  # already validated, re-encoded and downscaled JPEG
    image_mime: str
    occasion: str  # human label, e.g. "Work"
    preferred_style: str = ""
    desired_impression: str = ""
    additional_context: str = ""


@dataclass
class ProviderResult:
    data: dict  # normalized, schema-validated result
    provider: str
    model: str
    is_mock: bool
    latency_ms: int
    prompt_version: str
    metadata: dict = field(default_factory=dict)  # usage, finish_reason, etc. (no secrets)


class VisionProvider:
    name = "base"
    model = ""
    is_mock = False

    def is_configured(self) -> bool:
        raise NotImplementedError

    def analyze(self, request: AnalysisRequest) -> ProviderResult:
        raise NotImplementedError
