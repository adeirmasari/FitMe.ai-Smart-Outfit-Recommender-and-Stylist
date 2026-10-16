from rest_framework.routers import SimpleRouter

from .views import AnalysisViewSet

router = SimpleRouter()
router.register("", AnalysisViewSet, basename="analysis")

urlpatterns = router.urls
