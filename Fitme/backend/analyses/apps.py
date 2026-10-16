from django.apps import AppConfig


class AnalysesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "analyses"

    def ready(self):
        from . import signals  # noqa: F401
