from django.conf import settings

from .base import ProviderNotConfigured, VisionProvider


class _UnconfiguredProvider(VisionProvider):
    name = "none"
    model = ""

    def is_configured(self):
        return False

    def analyze(self, request):
        raise ProviderNotConfigured("AI_PROVIDER is not set")


def get_provider() -> VisionProvider:
    choice = settings.AI_PROVIDER
    if choice == "gemini":
        from .gemini import GeminiProvider

        return GeminiProvider()
    if choice == "qwen":
        from .qwen import QwenVLProvider

        return QwenVLProvider()
    if choice == "mock":
        from .mock import MockVisionProvider

        return MockVisionProvider()
    return _UnconfiguredProvider()


def provider_status():
    """Public, secret-free summary used by /api/health/ and the frontend."""
    provider = get_provider()
    return {
        "name": provider.name,
        "model": provider.model,
        "configured": provider.is_configured(),
        "is_mock": provider.is_mock,
    }
