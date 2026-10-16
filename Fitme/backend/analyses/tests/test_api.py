import io
import os
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from ai_services.base import InvalidModelOutput, ProviderTimeout, ProviderUnavailable
from ai_services.providers import _UnconfiguredProvider
from analyses.models import AnalysisStatus, OutfitAnalysis, OutfitRecommendation

from .helpers import FakeProvider, FitMeTestCase, image_bytes, upload

LIST = reverse("analysis-list")


def detail(pk):
    return reverse("analysis-detail", args=[pk])


def patch_provider(provider):
    return mock.patch("analyses.views.get_provider", return_value=provider)


class CreateAnalysisTests(FitMeTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.login(self.user)

    def post(self, **overrides):
        data = {"image": upload(), "occasion": "work", **overrides}
        return self.client.post(LIST, data, format="multipart")

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.post().status_code, 401)

    def test_valid_analysis_is_stored_and_returned(self):
        provider = FakeProvider()
        with patch_provider(provider):
            res = self.post(preferred_style="minimal", additional_context="Client meeting")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["status"], "completed")
        self.assertEqual(res.data["occasion_label"], "Work")
        rec = res.data["recommendation"]
        self.assertEqual(rec["clothing_items"][0]["name"], "Skinny jeans")
        self.assertFalse(rec["source"]["is_mock"])
        self.assertEqual(rec["source"]["model"], "fake-qwen")

        analysis = OutfitAnalysis.objects.get(pk=res.data["id"])
        self.assertEqual(analysis.owner, self.user)
        self.assertEqual(analysis.attempt_count, 1)
        self.assertTrue(os.path.exists(analysis.image.path))
        self.assertTrue(analysis.image.name.endswith(f"{analysis.id}.jpg"))
        # Provider received the occasion and fenced preferences.
        self.assertEqual(provider.calls[0].occasion, "Work")
        self.assertEqual(provider.calls[0].preferred_style, "minimal")

    def test_other_occasion_detail_kept_only_for_other(self):
        with patch_provider(FakeProvider()):
            res = self.post(occasion="other", occasion_detail="Gallery opening")
            self.assertEqual(res.data["occasion_label"], "Other: Gallery opening")
            res = self.post(occasion="party", occasion_detail="ignored")
            self.assertEqual(res.data["occasion_detail"], "")

    def test_status_is_processing_while_provider_runs(self):
        seen = {}

        def on_call(_request):
            seen["status"] = OutfitAnalysis.objects.get().status

        with patch_provider(FakeProvider(on_call=on_call)):
            self.post()
        self.assertEqual(seen["status"], AnalysisStatus.PROCESSING)

    def test_filename_path_traversal_is_ignored(self):
        with patch_provider(FakeProvider()):
            res = self.post(image=upload(name="../../etc/passwd.jpg"))
        self.assertEqual(res.status_code, 201)
        analysis = OutfitAnalysis.objects.get()
        self.assertTrue(analysis.image.path.startswith(self._media))
        self.assertNotIn("passwd", analysis.image.name)

    def test_exif_is_stripped_and_image_reencoded(self):
        exif = Image.Exif()
        exif[0x010F] = "SecretCam"  # Make
        with patch_provider(FakeProvider()):
            res = self.post(image=upload(data=image_bytes(exif=exif.tobytes())))
        analysis = OutfitAnalysis.objects.get(pk=res.data["id"])
        with Image.open(analysis.image.path) as stored:
            self.assertEqual(stored.format, "JPEG")
            self.assertEqual(len(stored.getexif()), 0)

    def test_png_with_transparency_accepted(self):
        buf = io.BytesIO()
        Image.new("RGBA", (400, 400), (10, 20, 30, 0)).save(buf, format="PNG")
        with patch_provider(FakeProvider()):
            res = self.post(image=upload(name="a.png", data=buf.getvalue(), content_type="image/png"))
        self.assertEqual(res.status_code, 201)


class InvalidUploadTests(FitMeTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.login(self.user)
        self.provider = FakeProvider()
        patcher = patch_provider(self.provider)
        patcher.start()
        self.addCleanup(patcher.stop)

    def assertRejected(self, data, field="image"):
        res = self.client.post(LIST, data, format="multipart")
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(res.data["error"]["code"], "validation_error")
        self.assertIn(field, res.data["error"]["fields"])
        self.assertEqual(OutfitAnalysis.objects.count(), 0)
        self.assertEqual(self.provider.calls, [])
        return res

    def test_missing_image(self):
        self.assertRejected({"occasion": "work"})

    def test_text_file_with_jpg_extension(self):
        self.assertRejected({"image": upload(data=b"definitely not an image"), "occasion": "work"})

    def test_disallowed_extension(self):
        self.assertRejected({"image": upload(name="outfit.svg", content_type="image/svg+xml"), "occasion": "work"})

    def test_gif_disguised_as_png(self):
        gif = image_bytes(fmt="GIF")
        self.assertRejected({"image": upload(name="x.png", data=gif, content_type="image/png"), "occasion": "work"})

    def test_browser_mime_type_mismatch(self):
        self.assertRejected({"image": upload(content_type="application/x-msdownload"), "occasion": "work"})

    def test_image_too_small(self):
        self.assertRejected({"image": upload(data=image_bytes(size=(100, 100))), "occasion": "work"})

    def test_truncated_image(self):
        self.assertRejected({"image": upload(data=image_bytes()[:400]), "occasion": "work"})

    @override_settings(FITME_MAX_UPLOAD_BYTES=1000)
    def test_file_too_large(self):
        res = self.assertRejected({"image": upload(), "occasion": "work"})
        self.assertIn("MB or smaller", res.data["error"]["message"])

    @override_settings(FITME_MAX_IMAGE_PIXELS=100_000)
    def test_decompression_bomb_guard(self):
        self.assertRejected({"image": upload(data=image_bytes(size=(1000, 1000))), "occasion": "work"})

    def test_invalid_occasion(self):
        self.assertRejected({"image": upload(), "occasion": "funeral"}, field="occasion")

    def test_overlong_context(self):
        self.assertRejected({"image": upload(), "occasion": "work", "additional_context": "x" * 301}, field="additional_context")


class ProviderFailureTests(FitMeTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.login(self.user)

    def post(self):
        return self.client.post(LIST, {"image": upload(), "occasion": "casual"}, format="multipart")

    def test_unconfigured_provider_returns_503_and_stores_nothing(self):
        with patch_provider(_UnconfiguredProvider()):
            res = self.post()
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["error"]["code"], "provider_not_configured")
        self.assertEqual(OutfitAnalysis.objects.count(), 0)

    def test_timeout_marks_failed_without_fake_result(self):
        with patch_provider(FakeProvider(error=ProviderTimeout("slow"))):
            res = self.post()
        self.assertEqual(res.status_code, 504)
        self.assertEqual(res.data["error"]["code"], "provider_timeout")
        self.assertEqual(res.data["analysis"]["status"], "failed")
        self.assertIsNone(res.data["analysis"]["recommendation"])
        self.assertTrue(res.data["analysis"]["error"]["retryable"])
        self.assertEqual(OutfitRecommendation.objects.count(), 0)
        # Internal detail ("slow") is not leaked.
        self.assertNotIn("slow", str(res.data))

    def test_malformed_output_is_502(self):
        with patch_provider(FakeProvider(error=InvalidModelOutput("garbage"))):
            res = self.post()
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.data["analysis"]["error"]["code"], "invalid_model_output")

    def test_unexpected_exception_is_contained(self):
        with patch_provider(FakeProvider(error=RuntimeError("boom"))):
            res = self.post()
        self.assertEqual(res.status_code, 502)
        self.assertEqual(OutfitAnalysis.objects.get().error_code, "internal_error")

    def test_retry_after_failure_then_completed(self):
        with patch_provider(FakeProvider(error=ProviderUnavailable("down"))):
            res = self.post()
        pk = res.data["analysis"]["id"]
        with patch_provider(FakeProvider()):
            res = self.client.post(reverse("analysis-retry", args=[pk]))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "completed")
        self.assertEqual(res.data["attempt_count"], 2)
        self.assertIsNotNone(res.data["recommendation"])

    def test_completed_analysis_cannot_be_retried(self):
        with patch_provider(FakeProvider()):
            pk = self.post().data["id"]
            res = self.client.post(reverse("analysis-retry", args=[pk]))
        self.assertEqual(res.status_code, 409)

    def test_retry_limit(self):
        with patch_provider(FakeProvider(error=ProviderUnavailable("down"))):
            pk = self.post().data["analysis"]["id"]
            OutfitAnalysis.objects.filter(pk=pk).update(attempt_count=5)
            res = self.client.post(reverse("analysis-retry", args=[pk]))
        self.assertEqual(res.status_code, 409)

    def test_stale_processing_becomes_retryable_failure(self):
        with patch_provider(FakeProvider()):
            pk = self.post().data["id"]
        OutfitAnalysis.objects.filter(pk=pk).update(
            status=AnalysisStatus.PROCESSING, processing_started_at=timezone.now() - timedelta(hours=1)
        )
        res = self.client.get(detail(pk))
        self.assertEqual(res.data["status"], "failed")
        self.assertEqual(res.data["error"]["code"], "processing_interrupted")


class HistoryAndPermissionTests(FitMeTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.make_user("owner")
        self.other = self.make_user("other")
        self.login(self.owner)
        with patch_provider(FakeProvider()):
            res = self.client.post(LIST, {"image": upload(), "occasion": "party"}, format="multipart")
        self.pk = res.data["id"]
        self.analysis = OutfitAnalysis.objects.get(pk=self.pk)

    def test_history_pagination(self):
        for _ in range(14):
            OutfitAnalysis.objects.create(owner=self.owner, image=self.analysis.image.name, occasion="casual", status="failed", error_code="provider_timeout")
        res = self.client.get(LIST)
        self.assertEqual(res.data["count"], 15)
        self.assertEqual(len(res.data["results"]), 12)
        self.assertIsNotNone(res.data["next"])
        res = self.client.get(LIST, {"page": 2})
        self.assertEqual(len(res.data["results"]), 3)
        res = self.client.get(LIST, {"page_size": 100})
        self.assertEqual(len(res.data["results"]), 15)  # capped at 50, all 15 fit

    def test_history_item_shape(self):
        item = self.client.get(LIST).data["results"][0]
        self.assertEqual(item["status"], "completed")
        self.assertTrue(item["summary"])
        self.assertTrue(item["thumbnail_url"].endswith("?variant=thumb"))

    def test_other_user_cannot_see_list_detail_image_retry_or_delete(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(LIST).data["count"], 0)
        self.assertEqual(self.client.get(detail(self.pk)).status_code, 404)
        self.assertEqual(self.client.get(reverse("analysis-image", args=[self.pk])).status_code, 404)
        self.assertEqual(self.client.post(reverse("analysis-retry", args=[self.pk])).status_code, 404)
        self.assertEqual(self.client.delete(detail(self.pk)).status_code, 404)
        self.assertTrue(OutfitAnalysis.objects.filter(pk=self.pk).exists())

    def test_owner_can_fetch_image_and_thumbnail(self):
        res = self.client.get(reverse("analysis-image", args=[self.pk]))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "image/jpeg")
        self.assertIn("private", res["Cache-Control"])
        thumb = self.client.get(reverse("analysis-image", args=[self.pk]) + "?variant=thumb")
        data = b"".join(thumb.streaming_content)
        with Image.open(io.BytesIO(data)) as img:
            self.assertLessEqual(max(img.size), 400)

    def test_delete_removes_record_recommendation_and_files(self):
        paths = [self.analysis.image.path, self.analysis.thumbnail.path]
        res = self.client.delete(detail(self.pk))
        self.assertEqual(res.status_code, 204)
        self.assertFalse(OutfitAnalysis.objects.filter(pk=self.pk).exists())
        self.assertEqual(OutfitRecommendation.objects.count(), 0)
        for path in paths:
            self.assertFalse(os.path.exists(path))

    def test_unknown_id_is_404(self):
        self.assertEqual(self.client.get(detail("00000000-0000-0000-0000-000000000000")).status_code, 404)
