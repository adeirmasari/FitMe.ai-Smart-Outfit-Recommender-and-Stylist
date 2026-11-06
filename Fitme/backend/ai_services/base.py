"""Provider-agnostic contracts for vision-language outfit analysis."""

from dataclasses import dataclass, field


class ProviderError(Exception):
    """Base class. `code` is stored on the analysis and shown to the user."""

    code = "provider_error"
    user_message = "The AI could not complete this analysis. Please try again."
    retryable = True


class ProviderNotConfigured(ProviderError):
    code = "provider_not_configured"
    user_message = "Analysis is unavailable because the AI service is not configured."
    retryable = False


class ProviderTimeout(ProviderError):
    code = "provider_timeout"
    user_message = "The AI took too long to respond. Please try again shortly."


class ProviderUnavailable(ProviderError):
    code = "provider_unavailable"
    user_message = "The AI service is temporarily unavailable. Please try again shortly."


class ProviderRejected(ProviderError):
    code = "provider_rejected"
    user_message = "The AI service rejected this request. Try using a different photo."
    retryable = False


class InvalidModelOutput(ProviderError):
    code = "invalid_model_output"
    user_message = "The AI response was incomplete. Try running this analysis again."

class WardrobeChanged(ProviderError):
    code = "wardrobe_changed"
    user_message = "Your wardrobe changed during the analysis. Generate a new recommendation."
    retryable = False


class ImageNotClothing(ProviderError):
    """Model melihat gambar yang bukan pakaian. Bukan kegagalan teknis, jadi tidak bisa dicoba ulang."""

    code = "image_not_clothing"
    user_message = "This photo was rejected because no clothing was detected."
    guidance = (
        "Use a clear photo of clothing, such as a top, bottom, shoes, or an outfit being worn. "
        "Make sure it has good lighting and is not cropped."
    )
    retryable = False

    def __init__(self, reason=""):
        super().__init__(reason or "image does not show clothing")
        self.reason = reason or ""


@dataclass(frozen=True)
class ClothingCheck:
    is_clothing: bool
    reason: str = ""


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

    def check_clothing(self, image_bytes: bytes):
        """Periksa apakah gambar berisi pakaian.

        Mengembalikan `ClothingCheck`, atau None jika provider tidak bisa
        memeriksa isi gambar (misalnya mock), sehingga pemeriksaan dilewati.
        """
        return None
