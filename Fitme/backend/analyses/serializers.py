from django.urls import reverse
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .imaging import ImageRejected, validate_and_process
from .models import (
    Occasion,
    OutfitAnalysis,
    OutfitRecommendation,
    WardrobeCategory,
    WardrobeItem,
)
from .services import error_info



class AnalysisCreateSerializer(serializers.Serializer):
    image = serializers.FileField(
        required=False,
        help_text="JPEG, PNG or WebP, up to 8 MB, at least 200px per side.",
    )
    wardrobe_item_id = serializers.UUIDField(required=False)
    occasion = serializers.ChoiceField(choices=Occasion.choices)
    occasion_detail = serializers.CharField(max_length=80, required=False, allow_blank=True)
    preferred_style = serializers.CharField(max_length=120, required=False, allow_blank=True)
    desired_impression = serializers.CharField(max_length=120, required=False, allow_blank=True)
    additional_context = serializers.CharField(max_length=300, required=False, allow_blank=True)

    def validate(self, attrs):
        image = attrs.get("image")
        wardrobe_item_id = attrs.get("wardrobe_item_id")

        if bool(image) == bool(wardrobe_item_id):
            raise serializers.ValidationError(
                "Provide either an uploaded image or a wardrobe item, but not both."
            )

        if image:
            try:
                self.context["processed_image"] = validate_and_process(image)
            except ImageRejected as exc:
                raise serializers.ValidationError({"image": str(exc)}) from exc

        return attrs


class WardrobeRecommendationRequestSerializer(serializers.Serializer):
    occasion = serializers.ChoiceField(choices=Occasion.choices)
    occasion_detail = serializers.CharField(
        max_length=80,
        required=False,
        allow_blank=True,
    )
    preferred_style = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
    )
    desired_impression = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
    )
    additional_context = serializers.CharField(
        max_length=300,
        required=False,
        allow_blank=True,
    )


class ErrorInfoSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    retryable = serializers.BooleanField()


class ClothingItemSerializer(serializers.Serializer):
    name = serializers.CharField()
    category = serializers.CharField(allow_blank=True)
    color = serializers.CharField(allow_blank=True)
    details = serializers.CharField(allow_blank=True)


class ColorSerializer(serializers.Serializer):
    name = serializers.CharField(allow_blank=True)
    hex = serializers.CharField(allow_null=True)


class ColorSuggestionSerializer(serializers.Serializer):
    palette = serializers.ListField(child=serializers.CharField())
    note = serializers.CharField(allow_blank=True)


class AlternativeOutfitSerializer(serializers.Serializer):
    title = serializers.CharField(allow_blank=True)
    description = serializers.CharField(allow_blank=True)
    items = serializers.ListField(child=serializers.CharField())


class RecommendationSerializer(serializers.ModelSerializer):
    outfits = serializers.JSONField(read_only=True)
    clothing_items = ClothingItemSerializer(many=True)
    dominant_colors = ColorSerializer(many=True)
    styling_observations = serializers.ListField(child=serializers.CharField())
    color_suggestions = ColorSuggestionSerializer(many=True)
    alternative_outfits = AlternativeOutfitSerializer(many=True)
    limitations = serializers.ListField(child=serializers.CharField())
    source = serializers.SerializerMethodField()

    class Meta:
        model = OutfitRecommendation
        fields = [
            "visual_analysis",
            "clothing_items",
            "dominant_colors",
            "styling_observations",
            "primary_recommendation",
            "color_suggestions",
            "alternative_outfits",
            "outfits",
            "occasion_rationale",
            "limitations",
            "source",
            "created_at",
        ]

    @extend_schema_field(
        {
            "type": "object",
            "properties": {
                "provider": {"type": "string"},
                "model": {"type": "string"},
                "is_mock": {"type": "boolean"},
                "prompt_version": {"type": "string"},
                "latency_ms": {"type": "integer"},
            },
        }
    )
    def get_source(self, obj):
        return {
            "provider": obj.provider,
            "model": obj.model_name,
            "is_mock": obj.is_mock,
            "prompt_version": obj.prompt_version,
            "latency_ms": obj.latency_ms,
        }


class _AnalysisBase(serializers.ModelSerializer):
    occasion_label = serializers.CharField(read_only=True)
    thumbnail_url = serializers.SerializerMethodField()
    error = serializers.SerializerMethodField()

    def get_thumbnail_url(self, obj) -> str:
        return reverse("analysis-image", args=[obj.pk]) + "?variant=thumb"

    @extend_schema_field(ErrorInfoSerializer(allow_null=True))
    def get_error(self, obj):
        return error_info(obj.error_code) if obj.status == "failed" else None


class AnalysisListSerializer(_AnalysisBase):
    summary = serializers.SerializerMethodField()
    is_mock = serializers.SerializerMethodField()

    class Meta:
        model = OutfitAnalysis
        fields = ["id", "source", "created_at", "occasion", "occasion_label", "status", "error", "thumbnail_url", "summary", "is_mock"]

    def _rec(self, obj):
        return getattr(obj, "recommendation", None) if obj.status == "completed" else None

    def get_summary(self, obj) -> str:
        rec = self._rec(obj)
        if not rec:
            return ""
        text = rec.primary_recommendation
        return text if len(text) <= 180 else text[:179].rstrip() + "…"

    def get_is_mock(self, obj) -> bool:
        rec = self._rec(obj)
        return bool(rec and rec.is_mock)


class AnalysisDetailSerializer(_AnalysisBase):
    image_url = serializers.SerializerMethodField()
    recommendation = serializers.SerializerMethodField()

    class Meta:
        model = OutfitAnalysis
        fields = [
            "id",
            "source",
            "created_at",
            "updated_at",
            "occasion",
            "occasion_detail",
            "occasion_label",
            "preferred_style",
            "desired_impression",
            "additional_context",
            "status",
            "error",
            "attempt_count",
            "image_url",
            "image_width",
            "image_height",
            "thumbnail_url",
            "recommendation",
        ]

    def get_image_url(self, obj) -> str:
        return reverse("analysis-image", args=[obj.pk])

    @extend_schema_field(RecommendationSerializer(allow_null=True))
    def get_recommendation(self, obj):
        if obj.status != "completed":
            return None
        rec = getattr(obj, "recommendation", None)
        return RecommendationSerializer(rec).data if rec else None


class WardrobeItemCreateSerializer(serializers.ModelSerializer):
    image = serializers.FileField(
        help_text="JPEG, PNG or WebP, up to 8 MB, at least 200px per side."
    )

    class Meta:
        model = WardrobeItem
        fields = ["id", "name", "category", "color", "image"]
        read_only_fields = ["id"]

    def validate_image(self, upload):
        try:
            self.context["processed_image"] = validate_and_process(upload)
        except ImageRejected as exc:
            raise serializers.ValidationError(str(exc), code=exc.code)
        return upload

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Nama pakaian wajib diisi.")
        return value

    def validate_color(self, value):
        return value.strip()


class WardrobeItemSerializer(serializers.ModelSerializer):
    thumbnail_url = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    category_label = serializers.CharField(
        source="get_category_display",
        read_only=True,
    )

    class Meta:
        model = WardrobeItem
        fields = [
            "id",
            "name",
            "category",
            "category_label",
            "color",
            "image_width",
            "image_height",
            "thumbnail_url",
            "image_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_thumbnail_url(self, obj):
        return reverse("wardrobe-image", args=[obj.pk]) + "?variant=thumb"

    def get_image_url(self, obj):
        return reverse("wardrobe-image", args=[obj.pk])
