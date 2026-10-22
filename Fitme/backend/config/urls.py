from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

from . import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", views.health, name="health"),
    path("api/auth/", include("accounts.urls")),
    path("api/profile/", include("accounts.profile_urls")),
    path("api/analyses/", include("analyses.urls")),
    path("api/wardrobe/", include("analyses.wardrobe_urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

if settings.DEBUG:
    from django.contrib.staticfiles.urls import staticfiles_urlpatterns

    urlpatterns += staticfiles_urlpatterns()

# Client-side routes. Anything that isn't API/admin/static falls through to the SPA shell.
urlpatterns += [
    re_path(r"^(?!api/|admin/|static/)(?P<path>.*)$", views.spa, name="spa"),
]
