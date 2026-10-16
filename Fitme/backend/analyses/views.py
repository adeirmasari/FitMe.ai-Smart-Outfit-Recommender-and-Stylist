from django.http import FileResponse, Http404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema, extend_schema_view, inline_serializer
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle

from ai_services.providers import get_provider

from . import services
from .models import AnalysisStatus, OutfitAnalysis
from .serializers import AnalysisCreateSerializer, AnalysisDetailSerializer, AnalysisListSerializer

FailedAnalysisResponse = inline_serializer(
    "FailedAnalysisResponse",
    {
        "error": inline_serializer(
            "FailedAnalysisError", {"code": serializers.CharField(), "message": serializers.CharField()}
        ),
        "analysis": AnalysisDetailSerializer(),
    },
)


def _failure_response(analysis):
    info = services.error_info(analysis.error_code)
    http_status = (
        status.HTTP_503_SERVICE_UNAVAILABLE
        if analysis.error_code == "provider_not_configured"
        else status.HTTP_504_GATEWAY_TIMEOUT
        if analysis.error_code == "provider_timeout"
        else status.HTTP_502_BAD_GATEWAY
    )
    return Response(
        {
            "error": {"code": info["code"], "message": info["message"]},
            "analysis": AnalysisDetailSerializer(analysis).data,
        },
        status=http_status,
    )


@extend_schema_view(
    list=extend_schema(tags=["analyses"], summary="List your analyses (newest first)"),
    retrieve=extend_schema(tags=["analyses"], summary="Get one of your analyses"),
    destroy=extend_schema(tags=["analyses"], summary="Delete an analysis and its stored photo"),
)
class AnalysisViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    lookup_value_regex = "[0-9a-fA-F-]{36}"

    def get_queryset(self):
        # Every query is scoped to the requesting user; other users' records are simply 404.
        qs = OutfitAnalysis.objects.filter(owner=self.request.user)
        if self.action in ("list", "retrieve"):
            services.expire_stale(qs)
        return qs.select_related("recommendation")

    def get_serializer_class(self):
        if self.action == "list":
            return AnalysisListSerializer
        if self.action == "create":
            return AnalysisCreateSerializer
        return AnalysisDetailSerializer

    def get_throttles(self):
        if self.action in ("create", "retry"):
            self.throttle_scope = "analysis_create"
            return [ScopedRateThrottle(), UserRateThrottle()]
        return [UserRateThrottle()]

    @extend_schema(
        tags=["analyses"],
        summary="Upload an outfit photo and analyze it",
        request={"multipart/form-data": AnalysisCreateSerializer},
        responses={
            201: AnalysisDetailSerializer,
            400: OpenApiResponse(description="Validation error (image, occasion or text fields)"),
            502: FailedAnalysisResponse,
            503: OpenApiResponse(description="No AI provider configured; nothing is stored"),
            504: FailedAnalysisResponse,
        },
    )
    def create(self, request):
        provider = get_provider()
        if not provider.is_configured():
            return Response(
                {
                    "error": {
                        "code": "provider_not_configured",
                        "message": "Outfit analysis is not available right now because no AI provider is configured.",
                    }
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        serializer = AnalysisCreateSerializer(data=request.data, context={})
        serializer.is_valid(raise_exception=True)
        fields = {k: v for k, v in serializer.validated_data.items() if k != "image"}
        analysis = services.create_analysis(request.user, serializer.context["processed_image"], fields)
        analysis = services.run_analysis(analysis, provider=provider)
        analysis = self.get_queryset().get(pk=analysis.pk)

        if analysis.status == AnalysisStatus.COMPLETED:
            return Response(AnalysisDetailSerializer(analysis).data, status=status.HTTP_201_CREATED)
        return _failure_response(analysis)

    @extend_schema(
        tags=["analyses"],
        summary="Retry a failed analysis with the same photo",
        request=None,
        responses={200: AnalysisDetailSerializer, 409: OpenApiResponse(description="Not retryable"), 502: FailedAnalysisResponse},
    )
    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        analysis = self.get_object()
        if analysis.status != AnalysisStatus.FAILED:
            return Response(
                {"error": {"code": "not_retryable", "message": "Only failed analyses can be retried."}},
                status=status.HTTP_409_CONFLICT,
            )
        provider = get_provider()
        try:
            services.run_analysis(analysis, provider=provider)
        except services.AnalysisConflict as exc:
            return Response({"error": {"code": "not_retryable", "message": str(exc)}}, status=status.HTTP_409_CONFLICT)
        analysis = self.get_queryset().get(pk=analysis.pk)
        if analysis.status == AnalysisStatus.COMPLETED:
            return Response(AnalysisDetailSerializer(analysis).data)
        return _failure_response(analysis)

    @extend_schema(
        tags=["analyses"],
        summary="Download the stored photo (owner only)",
        parameters=[OpenApiParameter("variant", str, enum=["full", "thumb"], required=False)],
        responses={(200, "image/jpeg"): OpenApiResponse(description="JPEG bytes")},
    )
    @action(detail=True, methods=["get"], url_path="image", url_name="image")
    def image(self, request, pk=None):
        analysis = self.get_object()
        field = analysis.thumbnail if request.query_params.get("variant") == "thumb" and analysis.thumbnail else analysis.image
        if not field or not field.storage.exists(field.name):
            raise Http404
        response = FileResponse(field.open("rb"), content_type="image/jpeg")
        response["Cache-Control"] = "private, max-age=3600"
        response["Content-Disposition"] = "inline"
        return response
