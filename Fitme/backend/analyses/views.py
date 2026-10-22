from django.http import FileResponse, Http404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema, extend_schema_view, inline_serializer
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle

from ai_services.providers import get_provider

from . import services
from .models import (
    AnalysisStatus,
    OutfitAnalysis,
    WardrobeItem,
)
from .serializers import (
    AnalysisCreateSerializer,
    AnalysisDetailSerializer,
    AnalysisListSerializer,
    WardrobeItemCreateSerializer,
    WardrobeItemSerializer,
)

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

        fields = {
            key: value
            for key, value in serializer.validated_data.items()
            if key not in ("image", "wardrobe_item_id")
        }

        if "wardrobe_item_id" in serializer.validated_data:
            try:
                item = WardrobeItem.objects.get(
                    pk=serializer.validated_data["wardrobe_item_id"],
                    owner=request.user,
                )
            except WardrobeItem.DoesNotExist:
                return Response(
                    {
                        "error": {
                            "code": "wardrobe_item_not_found",
                            "message": "Wardrobe item was not found.",
                        }
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )

            from .imaging import validate_and_process

            with item.image.open("rb") as image_file:
                processed_image = validate_and_process(image_file)
        else:
            processed_image = serializer.context["processed_image"]

        analysis = services.create_analysis(request.user, processed_image, fields)
        analysis = services.run_analysis(analysis, provider=provider)
        analysis = self.get_queryset().get(pk=analysis.pk)

        if analysis.status == AnalysisStatus.COMPLETED:
            return Response(
                AnalysisDetailSerializer(analysis).data,
                status=status.HTTP_201_CREATED,
            )

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

    
@extend_schema_view(
    list=extend_schema(
        tags=["wardrobe"],
        summary="List your wardrobe items",
    ),
    retrieve=extend_schema(
        tags=["wardrobe"],
        summary="Get one wardrobe item",
    ),
    create=extend_schema(
        tags=["wardrobe"],
        summary="Add a clothing item to your wardrobe",
        request={"multipart/form-data": WardrobeItemCreateSerializer},
    ),
    partial_update=extend_schema(
        tags=["wardrobe"],
        summary="Update wardrobe item details",
    ),
    destroy=extend_schema(
        tags=["wardrobe"],
        summary="Delete a wardrobe item and its stored images",
    ),
)
class WardrobeViewSet(viewsets.ModelViewSet):
    lookup_value_regex = "[0-9a-fA-F-]{36}"
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return WardrobeItem.objects.filter(owner=self.request.user)

    def get_serializer_class(self):
        if self.action == "create":
            return WardrobeItemCreateSerializer
        if self.action in ("partial_update", "update"):
            return WardrobeItemCreateSerializer
        return WardrobeItemSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(
            data=request.data,
            context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)

        processed = serializer.context["processed_image"]
        data = serializer.validated_data

        item = WardrobeItem(
            owner=request.user,
            name=data["name"],
            category=data["category"],
            color=data.get("color", ""),
            image_width=processed.width,
            image_height=processed.height,
        )

        try:
            from django.core.files.base import ContentFile

            item.image.save(
                "wardrobe.jpg",
                ContentFile(processed.full),
                save=False,
            )
            item.thumbnail.save(
                "wardrobe_thumb.jpg",
                ContentFile(processed.thumbnail),
                save=False,
            )
            item.save()
        except Exception:
            if item.image.name:
                item.image.storage.delete(item.image.name)
            if item.thumbnail.name:
                item.thumbnail.storage.delete(item.thumbnail.name)
            raise

        return Response(
            WardrobeItemSerializer(
                item,
                context=self.get_serializer_context(),
            ).data,
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        item = self.get_object()
        allowed = {"name", "category", "color"}
        unknown = set(request.data.keys()) - allowed

        if unknown:
            return Response(
                {
                    "error": {
                        "code": "invalid_fields",
                        "message": "Only name, category, and color can be updated.",
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = WardrobeItemCreateSerializer(
            item,
            data=request.data,
            partial=True,
            context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(
            WardrobeItemSerializer(
                item,
                context=self.get_serializer_context(),
            ).data
        )

    def perform_destroy(self, instance):
        # Remove stored files before deleting the database record.
        if instance.image:
            instance.image.delete(save=False)
        if instance.thumbnail:
            instance.thumbnail.delete(save=False)
        instance.delete()

    @extend_schema(
        tags=["wardrobe"],
        summary="Retrieve a wardrobe image (owner only)",
        parameters=[
            OpenApiParameter(
                "variant",
                str,
                enum=["full", "thumb"],
                required=False,
            )
        ],
        responses={(200, "image/jpeg"): OpenApiResponse(description="JPEG bytes")},
    )
    @action(
        detail=True,
        methods=["get"],
        url_path="image",
        url_name="image",
    )
    def image(self, request, pk=None):
        item = self.get_object()
        field = (
            item.thumbnail
            if request.query_params.get("variant") == "thumb"
            and item.thumbnail
            else item.image
        )

        if not field or not field.storage.exists(field.name):
            raise Http404

        response = FileResponse(
            field.open("rb"),
            content_type="image/jpeg",
        )
        response["Cache-Control"] = "private, max-age=3600"
        response["Content-Disposition"] = "inline"
        return response

