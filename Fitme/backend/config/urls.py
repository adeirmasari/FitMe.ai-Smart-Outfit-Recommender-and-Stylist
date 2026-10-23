from django.conf import settings
from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path, re_path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

from . import views


urlpatterns = [
    # Django Admin bawaan
    path("admin/", admin.site.urls),

    # Login pengguna pada frontend FitMe.ai
    path(
        "login",
        views.spa,
        {"path": "login"},
        name="spa-login",
    ),

    # Login administrator untuk dashboard
    path(
        "login/",
        views.website_login,
        name="login",
    ),
    path(
        "logout/",
        auth_views.LogoutView.as_view(
            next_page="/login/"
        ),
        name="logout",
    ),

    # API
    path(
        "api/health/",
        views.health,
        name="health",
    ),
    path(
        "api/auth/",
        include("accounts.urls"),
    ),
    path(
        "api/profile/",
        include("accounts.profile_urls"),
    ),
    path(
        "api/analyses/",
        include("analyses.urls"),
    ),
    path(
        "api/wardrobe/",
        include("analyses.wardrobe_urls"),
    ),
    path(
        "api/schema/",
        SpectacularAPIView.as_view(),
        name="schema",
    ),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(
            url_name="schema"
        ),
        name="swagger-ui",
    ),
    path(
        "api/redoc/",
        SpectacularRedocView.as_view(
            url_name="schema"
        ),
        name="redoc",
    ),

    # Dashboard administrator
    path(
        "dashboard/",
        views.dashboard,
        name="dashboard",
    ),
    path(
        "dashboard/users/",
        views.dashboard_detail,
        {"section": "users"},
        name="dashboard_users",
    ),
    path(
        "dashboard/analyses/",
        views.dashboard_detail,
        {"section": "analyses"},
        name="dashboard_analyses",
    ),
    path(
        "dashboard/recommendations/",
        views.dashboard_detail,
        {"section": "recommendations"},
        name="dashboard_recommendations",
    ),
    path(
        "dashboard/wardrobe/",
        views.dashboard_detail,
        {"section": "wardrobe"},
        name="dashboard_wardrobe",
    ),

    # Logout administrator
    path(
        "dashboard/logout/",
        auth_views.LogoutView.as_view(
            next_page="/login/"
        ),
        name="dashboard_logout",
    ),
]


if settings.DEBUG:
    from django.contrib.staticfiles.urls import (
        staticfiles_urlpatterns,
    )

    urlpatterns += staticfiles_urlpatterns()


# Halaman frontend selain route Django dan API
urlpatterns += [
    re_path(
        r"^(?!api/|admin/|login/|logout/|dashboard/|static/)(?P<path>.*)$",
        views.spa,
        name="spa",
    ),
]