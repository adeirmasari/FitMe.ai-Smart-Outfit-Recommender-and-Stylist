"""Development-only mock provider.

Enabled only with AI_PROVIDER=mock and refused by settings when DEBUG is off.
Its output is template text, flagged `is_mock=True` and shown in the UI with a
"Development mock — not AI output" label. Only the dominant colours are real:
they are measured from the image pixels with Pillow.
"""

import io
import time

from PIL import Image

from .base import ProviderResult, VisionProvider
from .prompts import PROMPT_VERSION
from .schema import normalize_result

_NAMED = {
    "black": (20, 20, 20), "charcoal": (60, 60, 64), "grey": (128, 128, 128), "light grey": (200, 200, 200),
    "white": (245, 245, 245), "cream": (240, 230, 210), "beige": (215, 195, 160), "camel": (190, 145, 90),
    "brown": (110, 70, 40), "navy": (25, 35, 80), "blue": (50, 90, 180), "light blue": (150, 190, 230),
    "denim": (80, 110, 150), "green": (50, 120, 60), "olive": (110, 110, 50), "red": (180, 30, 40),
    "burgundy": (110, 25, 45), "pink": (230, 160, 180), "orange": (220, 120, 40), "yellow": (230, 200, 60),
    "purple": (110, 60, 140),
}


def _nearest_name(rgb):
    return min(_NAMED, key=lambda n: sum((a - b) ** 2 for a, b in zip(_NAMED[n], rgb)))


def measured_colors(image_bytes, count=4):
    with Image.open(io.BytesIO(image_bytes)) as img:
        small = img.convert("RGB").resize((96, 96))
    quant = small.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    palette = quant.getpalette()
    ranked = sorted(quant.getcolors(), reverse=True)
    out, seen = [], set()
    for _, idx in ranked:
        rgb = tuple(palette[idx * 3 : idx * 3 + 3])
        if min(rgb) > 238:  # skip near-white studio backgrounds
            continue
        name = _nearest_name(rgb)
        if name in seen:
            continue
        seen.add(name)
        out.append({"name": name, "hex": "#%02x%02x%02x" % rgb})
        if len(out) == count:
            break
    return out


class MockVisionProvider(VisionProvider):
    name = "mock"
    model = "development-mock"
    is_mock = True

    def is_configured(self):
        return True

    def analyze(self, request):
        started = time.monotonic()
        colors = measured_colors(request.image_bytes)
        names = ", ".join(c["name"] for c in colors) or "neutral tones"
        raw = {
            "visual_analysis": (
                "[Development mock] No vision model was called. "
                f"Pixel sampling found these dominant tones: {names}."
            ),
            "clothing_items": [],
            "dominant_colors": colors,
            "styling_observations": ["[Development mock] Placeholder observation for UI testing."],
            "primary_recommendation": (
                f"[Development mock] Placeholder recommendation for the '{request.occasion}' occasion. "
                "Configure AI_PROVIDER=qwen to receive real Qwen2.5-VL styling advice."
            ),
            "color_suggestions": [{"palette": [c["name"] for c in colors[:2]], "note": "[Development mock] Measured colours only."}],
            "alternative_outfits": [],
            "occasion_rationale": "[Development mock] No occasion reasoning was generated.",
            "limitations": ["This result is a development fixture, not model output. Clothing items were not detected."],
        }
        return ProviderResult(
            data=normalize_result(raw),
            provider=self.name,
            model=self.model,
            is_mock=True,
            latency_ms=int((time.monotonic() - started) * 1000),
            prompt_version=PROMPT_VERSION,
            metadata={},
        )
