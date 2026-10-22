
from rest_framework.routers import SimpleRouter

from .views import WardrobeViewSet

router = SimpleRouter()
router.register("", WardrobeViewSet, basename="wardrobe")

urlpatterns = router.urls
