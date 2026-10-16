from django.contrib import admin

from .models import OutfitAnalysis, OutfitRecommendation


class RecommendationInline(admin.StackedInline):
    model = OutfitRecommendation
    extra = 0
    readonly_fields = ["provider", "model_name", "is_mock", "prompt_version", "latency_ms", "created_at"]


@admin.register(OutfitAnalysis)
class OutfitAnalysisAdmin(admin.ModelAdmin):
    list_display = ["id", "owner", "occasion", "status", "error_code", "created_at"]
    list_filter = ["status", "occasion"]
    search_fields = ["id", "owner__username"]
    readonly_fields = ["id", "created_at", "updated_at", "image_width", "image_height"]
    inlines = [RecommendationInline]
