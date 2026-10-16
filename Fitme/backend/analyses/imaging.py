"""Server-side upload validation and normalization.

Neither the filename nor the browser MIME type is trusted. Pillow decodes the
actual bytes; the image is then re-encoded to a fresh JPEG, which discards
EXIF (including GPS), ICC payloads and anything appended to the file.
"""

import io
import os
import warnings
from dataclasses import dataclass

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/jpg", "image/pjpeg"}


class ImageRejected(ValueError):
    def __init__(self, message, code="invalid_image"):
        super().__init__(message)
        self.code = code


@dataclass
class ProcessedImage:
    full: bytes
    thumbnail: bytes
    width: int
    height: int


def _encode_jpeg(img, quality):
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def _flatten(img):
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        return bg
    return img.convert("RGB")


def validate_and_process(upload):
    max_bytes = settings.FITME_MAX_UPLOAD_BYTES
    if upload.size is None or upload.size == 0:
        raise ImageRejected("The uploaded file is empty.", "empty_file")
    if upload.size > max_bytes:
        raise ImageRejected(f"Images must be {max_bytes // (1024 * 1024)} MB or smaller.", "file_too_large")

    ext = os.path.splitext(upload.name or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ImageRejected("Upload a JPEG, PNG or WebP image.", "unsupported_type")
    content_type = (getattr(upload, "content_type", "") or "").lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise ImageRejected("Upload a JPEG, PNG or WebP image.", "unsupported_type")

    data = upload.read()
    Image.MAX_IMAGE_PIXELS = settings.FITME_MAX_IMAGE_PIXELS
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as probe:
                if probe.format not in ALLOWED_FORMATS:
                    raise ImageRejected("Upload a JPEG, PNG or WebP image.", "unsupported_type")
                probe.verify()
            img = Image.open(io.BytesIO(data))
            img.load()
    except ImageRejected:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ImageRejected("This image is too large to process.", "image_too_large")
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise ImageRejected("This file is not a readable image.", "corrupt_image")

    width, height = img.size
    if min(width, height) < settings.FITME_MIN_IMAGE_SIDE:
        raise ImageRejected(
            f"The image is too small. Use at least {settings.FITME_MIN_IMAGE_SIDE}px on each side.", "image_too_small"
        )
    if max(width, height) > settings.FITME_MAX_IMAGE_SIDE:
        raise ImageRejected(f"Images can be at most {settings.FITME_MAX_IMAGE_SIDE}px on the longest side.", "image_too_large")

    img = _flatten(ImageOps.exif_transpose(img))
    img.thumbnail((settings.FITME_STORED_IMAGE_MAX_SIDE,) * 2, Image.Resampling.LANCZOS)
    full = _encode_jpeg(img, 88)

    thumb = img.copy()
    thumb.thumbnail((settings.FITME_THUMB_SIDE,) * 2, Image.Resampling.LANCZOS)
    thumbnail = _encode_jpeg(thumb, 80)
    return ProcessedImage(full=full, thumbnail=thumbnail, width=img.width, height=img.height)


def model_input(jpeg_bytes):
    """Downscale the stored image to the size sent to the vision model."""
    with Image.open(io.BytesIO(jpeg_bytes)) as img:
        img = img.convert("RGB")
        limit = settings.FITME_MODEL_IMAGE_MAX_SIDE
        if max(img.size) <= limit:
            return jpeg_bytes
        img.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        return _encode_jpeg(img, 85)
