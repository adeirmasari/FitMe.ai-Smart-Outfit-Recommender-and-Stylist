from django.conf import settings
from django.db import connection
from django.http import FileResponse, Http404
from django.views.decorators.http import require_GET
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from ai_services.providers import provider_status


@extend_schema(
    tags=["health"],
    responses=inline_serializer(
        "Health",
        {
            "status": serializers.CharField(),
            "database": serializers.CharField(),
            "ai_provider": serializers.DictField(),
        },
    ),
)
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def health(request):
    """Liveness plus dependency summary. Never exposes secrets or endpoints."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        database = "ok"
    except Exception:  # noqa: BLE001 - report, don't raise
        database = "unavailable"

    ai = provider_status()
    healthy = database == "ok"
    return Response(
        {"status": "ok" if healthy else "degraded", "database": database, "ai_provider": ai},
        status=200 if healthy else 503,
    )


@require_GET
def spa(request, path=""):
    """Serve the single-page frontend so client-side routes survive a refresh."""
    index = settings.FRONTEND_DIR / "index.html"
    if not index.is_file():
        raise Http404("Frontend not found")
    response = FileResponse(open(index, "rb"), content_type="text/html; charset=utf-8")
    response["Cache-Control"] = "no-cache"
    return response
