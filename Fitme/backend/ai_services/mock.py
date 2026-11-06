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
_COLOR_LABELS = {
    "black": "hitam",
    "charcoal": "abu-abu arang",
    "grey": "abu-abu",
    "light grey": "abu-abu muda",
    "white": "putih",
    "cream": "krem",
    "beige": "krem kecokelatan",
    "camel": "cokelat muda",
    "brown": "cokelat",
    "navy": "biru dongker",
    "blue": "biru",
    "light blue": "biru muda",
    "denim": "biru denim",
    "green": "hijau",
    "olive": "hijau zaitun",
    "red": "merah",
    "burgundy": "merah marun",
    "pink": "merah muda",
    "orange": "jingga",
    "yellow": "kuning",
    "purple": "ungu",
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
        for color in colors:
            color["name"] = _COLOR_LABELS.get(color["name"], color["name"])
        names = ", ".join(c["name"] for c in colors) or "warna netral"
        occasion = {
            "casual": "kasual",
            "campus": "kampus",
            "work": "kerja",
            "formal event": "acara formal",
            "party": "pesta",
        }.get(request.occasion.lower(), request.occasion)
        if occasion.lower().startswith("other:"):
            occasion = f"Lainnya:{occasion[6:]}"
        raw = {
            "visual_analysis": (
                "[Data uji] Model visual tidak dipanggil. "
                f"Pengambilan sampel piksel menemukan warna dominan: {names}."
            ),
            "clothing_items": [],
            "dominant_colors": colors,
            "styling_observations": ["[Data uji] Ini adalah contoh tampilan hasil analisis."],
            "primary_recommendation": (
                f"[Data uji] Contoh rekomendasi untuk acara {occasion}. "
                "Atur AI_PROVIDER ke layanan AI untuk mendapatkan saran gaya sebenarnya."
            ),
            "color_suggestions": [{"palette": [c["name"] for c in colors[:2]], "note": "[Data uji] Warna diukur dari foto."}],
            "alternative_outfits": [],
            "occasion_rationale": "[Data uji] Alasan khusus untuk acara tidak dibuat.",
            "limitations": ["Hasil ini adalah data uji, bukan keluaran model AI. Pakaian tidak dideteksi."],
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
