"""Analysis lifecycle: pending -> processing -> completed | failed.

Inference runs synchronously inside the request, bounded by the provider's
timeouts. A failed analysis keeps its image so the user can retry it.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from ai_services.base import AnalysisRequest, ProviderError
from ai_services.providers import get_provider

from .imaging import model_input
from .models import AnalysisStatus, OutfitAnalysis, OutfitRecommendation

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5

ERROR_MESSAGES = {
    "processing_interrupted": ("Processing was interrupted before it finished. You can retry this analysis.", True),
    "internal_error": ("Something went wrong while saving the result. You can retry this analysis.", True),
}


class AnalysisConflict(Exception):
    """Raised when an analysis is not in a state that allows the requested action."""


def error_info(code):
    """Map a stored error code to a safe user message and retry flag."""
    if not code:
        return None
    if code in ERROR_MESSAGES:
        message, retryable = ERROR_MESSAGES[code]
        return {"code": code, "message": message, "retryable": retryable}
    for cls in _provider_error_classes():
        if cls.code == code:
            return {"code": code, "message": cls.user_message, "retryable": cls.retryable}
    return {"code": code, "message": ProviderError.user_message, "retryable": True}


def _provider_error_classes():
    from ai_services import base

    return [
        base.ProviderNotConfigured,
        base.ProviderTimeout,
        base.ProviderUnavailable,
        base.ProviderRejected,
        base.InvalidModelOutput,
        base.ProviderError,
    ]


def stale_cutoff():
    budget = settings.QWEN["CONNECT_TIMEOUT_SECONDS"] + settings.QWEN["TIMEOUT_SECONDS"]
    budget *= 1 + settings.QWEN["MAX_RETRIES"]
    return timezone.now() - timedelta(seconds=budget + 60)


def expire_stale(queryset):
    """Records stuck in `processing` past the timeout budget (e.g. a worker crash) become retryable failures."""
    queryset.filter(status=AnalysisStatus.PROCESSING, processing_started_at__lt=stale_cutoff()).update(
        status=AnalysisStatus.FAILED, error_code="processing_interrupted", updated_at=timezone.now()
    )


def create_analysis(owner, processed_image, fields):
    analysis = OutfitAnalysis(
        owner=owner, image_width=processed_image.width, image_height=processed_image.height, **fields
    )
    analysis.image.save("upload.jpg", ContentFile(processed_image.full), save=False)
    analysis.thumbnail.save("thumb.jpg", ContentFile(processed_image.thumbnail), save=False)
    analysis.save()
    return analysis


def _claim(analysis_id):
    """Atomically move an analysis into `processing`, so concurrent retries can't double-run it."""
    with transaction.atomic():
        locked = OutfitAnalysis.objects.select_for_update().get(pk=analysis_id)
        if locked.status not in (AnalysisStatus.PENDING, AnalysisStatus.FAILED):
            raise AnalysisConflict("This analysis is already processing or complete.")
        if locked.attempt_count >= MAX_ATTEMPTS:
            raise AnalysisConflict("This analysis has reached its retry limit. Start a new analysis instead.")
        locked.status = AnalysisStatus.PROCESSING
        locked.error_code = ""
        locked.attempt_count += 1
        locked.processing_started_at = timezone.now()
        locked.save(update_fields=["status", "error_code", "attempt_count", "processing_started_at", "updated_at"])
        return locked


def _fail(analysis, code):
    analysis.status = AnalysisStatus.FAILED
    analysis.error_code = code
    analysis.save(update_fields=["status", "error_code", "updated_at"])


def run_analysis(analysis, provider=None):
    analysis = _claim(analysis.pk)
    provider = provider or get_provider()

    try:
        with analysis.image.open("rb") as fh:
            image_bytes = model_input(fh.read())
        request = AnalysisRequest(
            image_bytes=image_bytes,
            image_mime="image/jpeg",
            occasion=analysis.occasion_label,
            preferred_style=analysis.preferred_style,
            desired_impression=analysis.desired_impression,
            additional_context=analysis.additional_context,
        )
        result = provider.analyze(request)
    except ProviderError as exc:
        # Log the category and internal detail only; never the image or credentials.
        logger.warning("Analysis %s failed: %s (%s)", analysis.pk, exc.code, exc)
        _fail(analysis, exc.code)
        return analysis
    except Exception:
        logger.exception("Analysis %s failed unexpectedly", analysis.pk)
        _fail(analysis, "internal_error")
        return analysis

    try:
        with transaction.atomic():
            OutfitRecommendation.objects.update_or_create(
                analysis=analysis,
                defaults={
                    **{k: v for k, v in result.data.items() if k != "schema_version"},
                    "schema_version": result.data.get("schema_version", 1),
                    "provider": result.provider,
                    "model_name": result.model,
                    "is_mock": result.is_mock,
                    "prompt_version": result.prompt_version,
                    "latency_ms": result.latency_ms,
                    "provider_metadata": result.metadata,
                },
            )
            analysis.status = AnalysisStatus.COMPLETED
            analysis.error_code = ""
            analysis.save(update_fields=["status", "error_code", "updated_at"])
    except Exception:
        logger.exception("Saving result for analysis %s failed", analysis.pk)
        _fail(analysis, "internal_error")
    return analysis
