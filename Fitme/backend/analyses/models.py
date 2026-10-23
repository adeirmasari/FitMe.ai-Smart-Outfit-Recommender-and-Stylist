import uuid

from django.conf import settings
from django.db import models


def _image_path(instance, filename):
    # The client filename is discarded entirely: no traversal, no leaked names.
    return f"outfits/{instance.owner_id}/{instance.id}.jpg"


def _thumb_path(instance, filename):
    return f"outfits/{instance.owner_id}/{instance.id}_thumb.jpg"


class Occasion(models.TextChoices):
    CASUAL = "casual", "Casual"
    CAMPUS = "campus", "Campus"
    WORK = "work", "Work"
    FORMAL = "formal", "Formal event"
    PARTY = "party", "Party"
    OTHER = "other", "Other"


class AnalysisStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    PROCESSING = "processing", "Processing"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"


class OutfitAnalysis(models.Model):
    # UUIDs keep record ids unguessable; ownership is still enforced on every query.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="outfit_analyses")

    source = models.CharField(max_length=12, default="upload")
    wardrobe_snapshot = models.JSONField(default=list, blank=True)

    image = models.ImageField(upload_to=_image_path)
    image_width = models.PositiveIntegerField(default=0)
    image_height = models.PositiveIntegerField(default=0)
    thumbnail = models.ImageField(upload_to=_thumb_path, blank=True)

    occasion = models.CharField(max_length=16, choices=Occasion.choices)
    occasion_detail = models.CharField(max_length=80, blank=True)
    preferred_style = models.CharField(max_length=120, blank=True)
    desired_impression = models.CharField(max_length=120, blank=True)
    additional_context = models.CharField(max_length=300, blank=True)

    status = models.CharField(max_length=12, choices=AnalysisStatus.choices, default=AnalysisStatus.PENDING)
    error_code = models.CharField(max_length=40, blank=True)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    processing_started_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner", "-created_at"], name="analysis_owner_recent"),
            models.Index(fields=["status", "processing_started_at"], name="analysis_status_started"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(occasion__in=[c.value for c in Occasion]),
                name="analysis_occasion_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=[s.value for s in AnalysisStatus]),
                name="analysis_status_valid",
            ),
        ]

    def __str__(self):
        return f"OutfitAnalysis<{self.id}> {self.status}"

    @property
    def occasion_label(self):
        if self.occasion == Occasion.OTHER and self.occasion_detail:
            return f"Other: {self.occasion_detail}"
        return self.get_occasion_display()


class OutfitRecommendation(models.Model):
    """The validated, normalized model output for one analysis (latest attempt)."""

    analysis = models.OneToOneField(OutfitAnalysis, on_delete=models.CASCADE, related_name="recommendation")

    visual_analysis = models.TextField()
    clothing_items = models.JSONField(default=list)
    dominant_colors = models.JSONField(default=list)
    styling_observations = models.JSONField(default=list)
    primary_recommendation = models.TextField()
    color_suggestions = models.JSONField(default=list)
    alternative_outfits = models.JSONField(default=list)
    outfits = models.JSONField(default=list)
    occasion_rationale = models.TextField()
    limitations = models.JSONField(default=list)

    provider = models.CharField(max_length=40)
    model_name = models.CharField(max_length=120)
    is_mock = models.BooleanField(default=False)
    prompt_version = models.CharField(max_length=40)
    schema_version = models.PositiveSmallIntegerField(default=1)
    latency_ms = models.PositiveIntegerField(default=0)
    provider_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"OutfitRecommendation<{self.analysis_id}> via {self.provider}"


class WardrobeCategory(models.TextChoices):
    TOP = "top", "Atasan"
    BOTTOM = "bottom", "Bawahan"
    OUTERWEAR = "outerwear", "Outerwear"
    FOOTWEAR = "footwear", "Alas Kaki"
    ACCESSORY = "accessory", "Aksesori"
    OTHER = "other", "Lainnya"


def _wardrobe_image_path(instance, filename):
    return f"wardrobe/{instance.owner_id}/{instance.id}.jpg"


def _wardrobe_thumb_path(instance, filename):
    return f"wardrobe/{instance.owner_id}/{instance.id}_thumb.jpg"


class WardrobeItem(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wardrobe_items",
    )
    name = models.CharField(max_length=80)
    category = models.CharField(
        max_length=16,
        choices=WardrobeCategory.choices,
        default=WardrobeCategory.OTHER,
    )
    image = models.ImageField(upload_to=_wardrobe_image_path)
    thumbnail = models.ImageField(
        upload_to=_wardrobe_thumb_path,
        blank=True,
    )
    image_width = models.PositiveIntegerField(default=0)
    image_height = models.PositiveIntegerField(default=0)
    color = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["owner", "-created_at"],
                name="wardrobe_owner_recent",
            ),
            models.Index(
                fields=["owner", "category"],
                name="wardrobe_owner_category",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_category_display()})"

