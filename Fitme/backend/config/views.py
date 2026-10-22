from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import user_passes_test
from django.core.paginator import Paginator
from django.db import connection
from django.db.models import Count
from django.http import FileResponse, Http404
from django.shortcuts import render
from django.views.decorators.http import require_GET

from django.contrib.auth import authenticate, login
from django.shortcuts import redirect, render

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from analyses.models import (
    OutfitAnalysis,
    OutfitRecommendation,
    WardrobeItem,
)
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
    except Exception:  # noqa: BLE001
        database = "unavailable"

    ai = provider_status()
    healthy = database == "ok"

    return Response(
        {
            "status": "ok" if healthy else "degraded",
            "database": database,
            "ai_provider": ai,
        },
        status=200 if healthy else 503,
    )


@require_GET
def spa(request, path=""):
    index = settings.FRONTEND_DIR / "index.html"

    if not index.is_file():
        raise Http404("Frontend not found")

    response = FileResponse(
        open(index, "rb"),
        content_type="text/html; charset=utf-8",
    )
    response["Cache-Control"] = "no-cache"
    return response


def is_admin(user):
    """Only authenticated staff members can access the admin dashboard."""
    return user.is_authenticated and user.is_staff


# Halaman utama dashboard admin.
@user_passes_test(is_admin, login_url="/login/")
def dashboard(request):
    """Display dashboard statistics and the latest activity for each user."""
    User = get_user_model()

    stats = {
        "total_users": User.objects.count(),
        "total_analyses": OutfitAnalysis.objects.count(),
        "total_recommendations": OutfitRecommendation.objects.count(),
        "total_wardrobe_items": WardrobeItem.objects.count(),
    }

    # Hitung jumlah analisis setiap pengguna.
    users = User.objects.annotate(
        total_analyses=Count("outfit_analyses")
    ).order_by("username")

    user_activities = []

    for user in users:
        latest_analysis = (
            OutfitAnalysis.objects
            .filter(owner=user)
            .order_by("-created_at")
            .first()
        )

        user_activities.append(
            {
                "user": user,
                "total_analyses": user.total_analyses,
                "latest_analysis": latest_analysis,
            }
        )

    return render(
        request,
        "config/dashboard.html",
        {
            "stats": stats,
            "user_activities": user_activities,
        },
    )


# Halaman detail dashboard: pengguna, analisis, rekomendasi, wardrobe.
@user_passes_test(is_admin, login_url="/login/")
def dashboard_detail(request, section):
    """Display paginated detail pages for dashboard sections."""
    User = get_user_model()

    if section == "users":
        title = "Daftar Pengguna"
        rows = User.objects.order_by("-date_joined")
        fields = ["username", "email", "date_joined"]

    elif section == "analyses":
        title = "Analisis Outfit"
        rows = OutfitAnalysis.objects.select_related(
            "owner"
        ).order_by("-created_at")
        fields = [
            "owner",
            "occasion",
            "preferred_style",
            "status",
            "created_at",
        ]

    elif section == "recommendations":
        title = "Rekomendasi Outfit"
        rows = OutfitRecommendation.objects.select_related(
            "analysis",
            "analysis__owner",
        ).order_by("-created_at")
        fields = ["analysis", "created_at"]

    elif section == "wardrobe":
        title = "Wardrobe"
        rows = WardrobeItem.objects.select_related(
            "owner"
        ).order_by("-created_at")
        fields = [
            "owner",
            "name",
            "category",
            "color",
            "created_at",
        ]

    else:
        raise Http404("Halaman detail tidak ditemukan")

    page_obj = Paginator(rows, 15).get_page(
        request.GET.get("page")
    )

    return render(
        request,
        "config/dashboard_detail.html",
        {
            "section": section,
            "title": title,
            "fields": fields,
            "page_obj": page_obj,
        },
    )


def website_login(request):
    if request.user.is_authenticated:
        if request.user.is_staff or request.user.is_superuser:
            return redirect("/dashboard/")
        return redirect("/")

    if request.method == "POST":
        username = request.POST.get("username", "").strip()
        password = request.POST.get("password", "")

        user = authenticate(
            request,
            username=username,
            password=password,
        )

        if user is not None:
            if not (user.is_staff or user.is_superuser):
                return render(
                    request,
                    "config/login.html",
                    {"error": "Akun ini tidak memiliki akses admin."},
                )

            login(request, user)
            return redirect("/dashboard/")

        return render(
            request,
            "config/login.html",
            {"error": "Username atau password salah."},
        )

    return render(request, "config/login.html")
