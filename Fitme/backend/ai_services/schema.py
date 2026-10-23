"""Parse and normalize the model's structured answer.

The model is asked for JSON but is never trusted to produce it. Everything is
coerced into a bounded, predictable shape; anything unusable raises
`InvalidModelOutput` so the analysis is marked failed instead of crashing.
"""

import json
import re
import unicodedata

from .base import InvalidModelOutput

SCHEMA_VERSION = 1

MAX_TEXT = 1200
MAX_SHORT = 160
MAX_ITEMS = 12

_HEX = re.compile(r"^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def _clean(value, limit):
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value) if isinstance(value, (int, float)) else ""
    # Drop control characters (keep newlines/tabs) and collapse runs of blank lines.
    value = "".join(ch for ch in value if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    value = re.sub(r"\n{3,}", "\n\n", value).strip()
    if len(value) > limit:
        value = value[: limit - 1].rstrip() + "…"
    return value


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)[:MAX_ITEMS]
    return [value]


def _string_list(value, limit=MAX_SHORT * 2):
    out = []
    for item in _as_list(value):
        if isinstance(item, dict):
            item = item.get("text") or item.get("description") or item.get("note") or ""
        text = _clean(item, limit)
        if text:
            out.append(text)
    return out


def _hex(value):
    if not isinstance(value, str):
        return None
    match = _HEX.match(value.strip())
    if not match:
        return None
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(c * 2 for c in digits)
    return "#" + digits.lower()


def _clothing_items(value):
    out = []
    for item in _as_list(value):
        if isinstance(item, str):
            item = {"name": item}
        if not isinstance(item, dict):
            continue
        name = _clean(item.get("name") or item.get("item") or item.get("type"), MAX_SHORT)
        if not name:
            continue
        out.append(
            {
                "name": name,
                "category": _clean(item.get("category"), 60),
                "color": _clean(item.get("color") or item.get("colour"), 60),
                "details": _clean(item.get("details") or item.get("description"), MAX_SHORT * 2),
            }
        )
    return out


def _colors(value):
    out = []
    for item in _as_list(value):
        if isinstance(item, str):
            hex_value = _hex(item)
            item = {"name": "" if hex_value else item, "hex": hex_value}
        if not isinstance(item, dict):
            continue
        name = _clean(item.get("name") or item.get("color"), 60)
        hex_value = _hex(item.get("hex") or item.get("code"))
        if name or hex_value:
            out.append({"name": name, "hex": hex_value})
    return out


def _color_suggestions(value):
    out = []
    for item in _as_list(value):
        if isinstance(item, str):
            item = {"note": item}
        if not isinstance(item, dict):
            continue
        palette = [_clean(c if isinstance(c, str) else (c or {}).get("name"), 40) for c in _as_list(item.get("palette") or item.get("colors"))]
        palette = [c for c in palette if c][:6]
        note = _clean(item.get("note") or item.get("description") or item.get("why"), MAX_SHORT * 2)
        if palette or note:
            out.append({"palette": palette, "note": note})
    return out


def _alternatives(value):
    out = []
    for item in _as_list(value):
        if isinstance(item, str):
            item = {"description": item}
        if not isinstance(item, dict):
            continue
        title = _clean(item.get("title") or item.get("name"), MAX_SHORT)
        description = _clean(item.get("description") or item.get("outfit") or item.get("details"), MAX_SHORT * 3)
        items = _string_list(item.get("items"), MAX_SHORT)
        if title or description or items:
            out.append({"title": title, "description": description, "items": items})
    return out


def extract_json(text):
    """Pull the first JSON object out of a model response."""
    if not isinstance(text, str) or not text.strip():
        raise InvalidModelOutput("empty model response")
    candidates = [text.strip()]
    fenced = _FENCE.search(text)
    if fenced:
        candidates.insert(0, fenced.group(1).strip())
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (ValueError, RecursionError):
            continue
        if isinstance(parsed, dict):
            return parsed
    raise InvalidModelOutput("model response was not a JSON object")


def normalize_result(raw):
    if not isinstance(raw, dict):
        raise InvalidModelOutput("result is not an object")

    result = {
        "schema_version": SCHEMA_VERSION,
        "visual_analysis": _clean(raw.get("visual_analysis"), MAX_TEXT),
        "clothing_items": _clothing_items(raw.get("clothing_items")),
        "dominant_colors": _colors(raw.get("dominant_colors")),
        "styling_observations": _string_list(raw.get("styling_observations")),
        "primary_recommendation": _clean(raw.get("primary_recommendation"), MAX_TEXT),
        "color_suggestions": _color_suggestions(raw.get("color_suggestions")),
        "alternative_outfits": _alternatives(raw.get("alternative_outfits")),
        "occasion_rationale": _clean(raw.get("occasion_rationale"), MAX_TEXT),
        "limitations": _string_list(raw.get("limitations")),
    }

    missing = [k for k in ("visual_analysis", "primary_recommendation", "occasion_rationale") if not result[k]]
    if missing:
        raise InvalidModelOutput(f"missing required fields: {', '.join(missing)}")
    return result


def parse_model_text(text):
    return normalize_result(extract_json(text))

def normalize_wardrobe_result(raw, catalog):
    """Ubah label W1/W2 dari Gemini menjadi UUID pakaian yang sah."""
    if not isinstance(raw, dict) or not isinstance(raw.get("outfits"), list):
        raise InvalidModelOutput("missing outfits array")

    by_ref = {item["ref"]: item for item in catalog}
    tops = [item for item in catalog if item["category"] == "top"]
    bottoms = [item for item in catalog if item["category"] == "bottom"]
    needed = min(2, len(tops) * len(bottoms))

    if len(raw["outfits"]) != needed:
        raise InvalidModelOutput(f"expected {needed} distinct outfit(s)")

    outfits = []
    seen = set()

    for index, entry in enumerate(raw["outfits"], start=1):
        if not isinstance(entry, dict):
            raise InvalidModelOutput("outfit entry is not an object")

        top = by_ref.get(str(entry.get("top_ref", "")).strip())
        bottom = by_ref.get(str(entry.get("bottom_ref", "")).strip())
        reason = _clean(entry.get("reason"), 600)

        if (
            not top
            or top["category"] != "top"
            or not bottom
            or bottom["category"] != "bottom"
        ):
            raise InvalidModelOutput(
                "outfit references do not match an owned top and bottom"
            )

        pair = (top["id"], bottom["id"])
        if pair in seen or not reason:
            raise InvalidModelOutput(
                "outfit pair repeated or missing reason"
            )
        seen.add(pair)

        outfits.append({
            "title": _clean(entry.get("title"), 100) or f"Outfit {index}",
            "reason": reason,
            "top_id": top["id"],
            "bottom_id": bottom["id"],
            "items": [
                {
                    "wardrobe_item_id": item["id"],
                    "category": item["category"],
                    "name": item["name"],
                    "color": item["color"],
                }
                for item in (top, bottom)
            ],
        })

    return {
        "schema_version": 2,
        "visual_analysis": (
            "Rekomendasi berdasarkan foto koleksi Digital Wardrobe."
        ),
        "clothing_items": [],
        "dominant_colors": [],
        "styling_observations": [],
        "primary_recommendation": outfits[0]["reason"],
        "color_suggestions": [],
        "alternative_outfits": [],
        "outfits": outfits,
        "occasion_rationale": outfits[0]["reason"],
        "limitations": [],
    }