"""Kolase berlabel untuk menghubungkan foto dengan katalog pakaian."""

import io
import math

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image, ImageDraw, ImageFont, ImageOps

from .imaging import validate_and_process


def build_wardrobe_collage(items):
    width, height, columns = 320, 360, 3
    canvas = Image.new(
        "RGB",
        (width * columns, height * math.ceil(len(items) / columns)),
        "#f4f1ea",
    )
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=22)

    for index, item in enumerate(items):
        x = (index % columns) * width
        y = (index // columns) * height

        field = item.thumbnail if item.thumbnail else item.image
        with field.open("rb") as file:
            with Image.open(file) as original:
                photo = ImageOps.contain(
                    ImageOps.exif_transpose(original).convert("RGB"),
                    (300, 300),
                )

        draw.rectangle(
            (x + 8, y + 8, x + 312, y + 348),
            fill="white",
        )
        canvas.paste(
            photo,
            (
                x + (width - photo.width) // 2,
                y + 8 + (300 - photo.height) // 2,
            ),
        )
        draw.text(
            (x + 16, y + 318),
            f"W{index + 1}  {item.category}",
            fill="black",
            font=font,
        )

    buffer = io.BytesIO()
    canvas.save(buffer, format="JPEG", quality=85)
    uploaded = SimpleUploadedFile(
        "wardrobe-collage.jpg",
        buffer.getvalue(),
        content_type="image/jpeg",
    )
    return validate_and_process(uploaded)