"""Provider-agnostic contracts for vision-language outfit analysis."""

from dataclasses import dataclass, field


class ProviderError(Exception):
    """Base class. `code` is stored on the analysis and shown to the user."""

    code = "provider_error"
    user_message = "AI belum dapat menyelesaikan analisis ini. Silakan coba lagi."
    retryable = True


class ProviderNotConfigured(ProviderError):
    code = "provider_not_configured"
    user_message = "Analisis belum tersedia karena layanan AI belum dikonfigurasi."
    retryable = False


class ProviderTimeout(ProviderError):
    code = "provider_timeout"
    user_message = "AI terlalu lama merespons. Silakan coba lagi sebentar lagi."


class ProviderUnavailable(ProviderError):
    code = "provider_unavailable"
    user_message = "Layanan AI sedang tidak tersedia. Silakan coba lagi sebentar lagi."


class ProviderRejected(ProviderError):
    code = "provider_rejected"
    user_message = "Layanan AI menolak permintaan ini. Coba gunakan foto lain."
    retryable = False


class InvalidModelOutput(ProviderError):
    code = "invalid_model_output"
    user_message = "Jawaban AI tidak lengkap. Coba ulangi analisis ini."

class WardrobeChanged(ProviderError):
    code = "wardrobe_changed"
    user_message = "Koleksi pakaian berubah selama analisis. Buat rekomendasi baru."
    retryable = False


class ImageNotClothing(ProviderError):
    """Model melihat gambar yang bukan pakaian. Bukan kegagalan teknis, jadi tidak bisa dicoba ulang."""

    code = "image_not_clothing"
    user_message = "Foto ditolak karena tidak terdeteksi sebagai pakaian."
    guidance = (
        "Gunakan foto yang menampilkan pakaian secara jelas, misalnya atasan, bawahan, "
        "sepatu, atau pakaian yang sedang dikenakan, dengan pencahayaan cukup dan tidak terpotong."
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
