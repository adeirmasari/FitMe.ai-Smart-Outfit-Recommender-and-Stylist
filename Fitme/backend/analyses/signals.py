from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import OutfitAnalysis


@receiver(post_delete, sender=OutfitAnalysis)
def delete_image_files(sender, instance, **kwargs):
    """Deleting an analysis removes its stored photo and thumbnail from disk."""
    for field in (instance.image, instance.thumbnail):
        if field and field.name:
            field.storage.delete(field.name)
