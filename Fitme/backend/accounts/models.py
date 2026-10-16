from django.conf import settings
from django.db import models


class Profile(models.Model):
    """Styling-related account details. Authentication data stays on the User model."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    display_name = models.CharField(max_length=60, blank=True)
    style_notes = models.CharField(
        max_length=300,
        blank=True,
        help_text="Free-text style preferences used as default context for new analyses.",
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile<{self.user_id}>"
