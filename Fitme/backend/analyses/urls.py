
from rest_framework.routers import SimpleRouter

from .views import AnalysisViewSet, WardrobeViewSet

analysis_router = SimpleRouter()
analysis_router.register("", AnalysisViewSet, basename="analysis")

wardrobe_router = SimpleRouter()
wardrobe_router.register("", WardrobeViewSet, basename="wardrobe")

urlpatterns = [
    *analysis_router.urls,
    *wardrobe_router.urls,
]
