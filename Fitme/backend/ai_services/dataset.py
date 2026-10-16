"""Reader for the bundled Polyvore-derived outfit dataset (dataset/000/*.json + *.jpg).

Each sample is a composite image of a *partial* outfit plus the items a stylist
recommended to complete it (`target_items`) and a short styling conversation.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class DatasetSample:
    key: str
    image_path: Path
    partial_items: list  # [{"subcategory", "description"}]
    target_items: list
    conversation: list


def iter_samples(root, limit=None):
    root = Path(root)
    count = 0
    for meta_path in sorted(root.glob("*.json")):
        image_path = meta_path.with_suffix(".jpg")
        if not image_path.is_file():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        yield DatasetSample(
            key=str(meta.get("key", meta_path.stem)),
            image_path=image_path,
            partial_items=meta.get("partial_outfit") or [],
            target_items=meta.get("target_items") or [],
            conversation=meta.get("conversation") or [],
        )
        count += 1
        if limit and count >= limit:
            return


def target_keywords(item):
    """'Sweaters & knitwear' -> {'sweater', 'knitwear'} (rough singularization)."""
    words = set()
    for part in re.split(r"[&,/]| and ", (item.get("subcategory") or "").lower()):
        part = part.strip()
        if not part:
            continue
        if part.endswith("es") and part[:-2].endswith(("ss", "sh", "ch", "x")):
            part = part[:-2]
        elif part.endswith("s") and not part.endswith("ss"):
            part = part[:-1]
        words.add(part)
    return words
