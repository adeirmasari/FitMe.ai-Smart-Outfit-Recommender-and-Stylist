import io
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from ai_services.base import ProviderResult, VisionProvider
from ai_services.schema import normalize_result

User = get_user_model()

VALID_RESULT = {
    "visual_analysis": "A black skinny jean and pointed black suede pumps on a white background.",
    "clothing_items": [
        {"name": "Skinny jeans", "category": "bottom", "color": "black", "details": "zip pockets"},
        {"name": "Pointed pumps", "category": "footwear", "color": "black", "details": "appears to be suede"},
    ],
    "dominant_colors": [{"name": "black", "hex": "#111111"}],
    "styling_observations": ["Monochrome base", "Sleek silhouette"],
    "primary_recommendation": "Add a heather grey crew-neck sweater for texture against the black base.",
    "color_suggestions": [{"palette": ["heather grey", "camel"], "note": "Soft neutrals warm up the black."}],
    "alternative_outfits": [{"title": "Office layer", "items": ["camel coat"], "description": "Belted camel coat."}],
    "occasion_rationale": "Neutral knitwear keeps the look polished for work.",
    "limitations": ["The top half of the outfit is not visible."],
}


def image_bytes(fmt="JPEG", size=(640, 800), color=(30, 30, 30), exif=None):
    buf = io.BytesIO()
    img = Image.new("RGB", size, color)
    kwargs = {"exif": exif} if exif is not None else {}
    img.save(buf, format=fmt, **kwargs)
    return buf.getvalue()


def upload(name="outfit.jpg", data=None, content_type="image/jpeg"):
    return SimpleUploadedFile(name, data if data is not None else image_bytes(), content_type=content_type)


class FakeProvider(VisionProvider):
    name = "fake"
    model = "fake-qwen"

    def __init__(self, result=None, error=None, on_call=None):
        self.result = VALID_RESULT if result is None else result
        self.error = error
        self.on_call = on_call
        self.calls = []

    def is_configured(self):
        return True

    def analyze(self, request):
        self.calls.append(request)
        if self.on_call:
            self.on_call(request)
        if self.error:
            raise self.error
        return ProviderResult(
            data=normalize_result(self.result),
            provider=self.name,
            model=self.model,
            is_mock=False,
            latency_ms=12,
            prompt_version="test",
        )


class FitMeTestCase(APITestCase):
    """Isolated media dir and a clean throttle cache for every test."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self._media = tempfile.mkdtemp(prefix="fitme-test-media-")
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()

    def tearDown(self):
        self._override.disable()
        shutil.rmtree(self._media, ignore_errors=True)
        super().tearDown()

    def make_user(self, username="ana", password="Str0ng-pass-123"):
        return User.objects.create_user(username=username, email=f"{username}@example.com", password=password)

    def login(self, user):
        self.client.force_authenticate(user=user)
