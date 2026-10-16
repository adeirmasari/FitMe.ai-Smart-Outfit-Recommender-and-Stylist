from django.conf import settings
from django.urls import reverse

from analyses.tests.helpers import FitMeTestCase

WEB = {"HTTP_X_FITME_CLIENT": "web"}
COOKIE = settings.JWT_REFRESH_COOKIE["NAME"]


class RegistrationTests(FitMeTestCase):
    url = reverse("auth-register")

    def test_register_returns_access_and_sets_httponly_refresh_cookie_for_web(self):
        res = self.client.post(self.url, {"username": "ana", "email": "Ana@Example.com", "password": "Str0ng-pass-123"}, **WEB)
        self.assertEqual(res.status_code, 201)
        self.assertIn("access", res.data)
        self.assertNotIn("refresh", res.data)
        self.assertEqual(res.data["user"]["email"], "ana@example.com")
        cookie = res.cookies[COOKIE]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["path"], "/api/auth/")
        self.assertEqual(cookie["samesite"], "Strict")

    def test_api_client_receives_refresh_in_body(self):
        res = self.client.post(self.url, {"username": "bobby", "email": "bobby@example.com", "password": "Str0ng-pass-123"})
        self.assertEqual(res.status_code, 201)
        self.assertIn("refresh", res.data)
        self.assertNotIn(COOKIE, res.cookies)

    def test_password_is_hashed(self):
        self.client.post(self.url, {"username": "cyrus", "email": "cyrus@example.com", "password": "Str0ng-pass-123"})
        from django.contrib.auth import get_user_model

        user = get_user_model().objects.get(username="cyrus")
        self.assertNotEqual(user.password, "Str0ng-pass-123")
        self.assertTrue(user.check_password("Str0ng-pass-123"))

    def test_duplicate_username_and_email_rejected(self):
        self.make_user("ana")
        res = self.client.post(self.url, {"username": "ANA", "email": "ana@example.com", "password": "Str0ng-pass-123"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "validation_error")
        self.assertIn("username", res.data["error"]["fields"])
        self.assertIn("email", res.data["error"]["fields"])

    def test_weak_password_and_bad_username_rejected(self):
        res = self.client.post(self.url, {"username": "a b", "email": "x@example.com", "password": "12345678"})
        self.assertEqual(res.status_code, 400)
        fields = res.data["error"]["fields"]
        self.assertIn("username", fields)

        res = self.client.post(self.url, {"username": "goodname", "email": "x@example.com", "password": "password"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.data["error"]["fields"])


class LoginRefreshLogoutTests(FitMeTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user("ana")

    def test_login_with_username_or_email(self):
        for ident in ("ana", "ANA@example.com"):
            res = self.client.post(reverse("auth-token"), {"username": ident, "password": "Str0ng-pass-123"}, **WEB)
            self.assertEqual(res.status_code, 200, ident)
            self.assertIn("access", res.data)
            self.assertIn(COOKIE, res.cookies)

    def test_wrong_password_is_401_with_safe_message(self):
        res = self.client.post(reverse("auth-token"), {"username": "ana", "password": "nope-nope-1"})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["message"], "Incorrect username/email or password.")

    def test_access_token_authorizes_api(self):
        res = self.client.post(reverse("auth-token"), {"username": "ana", "password": "Str0ng-pass-123"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        self.assertEqual(self.client.get(reverse("profile")).status_code, 200)

    def test_cookie_refresh_requires_web_header(self):
        self.client.post(reverse("auth-token"), {"username": "ana", "password": "Str0ng-pass-123"}, **WEB)
        # Cookie present but no custom header: treated like a cross-site request.
        res = self.client.post(reverse("auth-token-refresh"))
        self.assertEqual(res.status_code, 401)
        res = self.client.post(reverse("auth-token-refresh"), **WEB)
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.data)
        self.assertNotIn("refresh", res.data)

    def test_body_refresh_for_api_clients_and_rotation(self):
        login = self.client.post(reverse("auth-token"), {"username": "ana", "password": "Str0ng-pass-123"})
        old = login.data["refresh"]
        res = self.client.post(reverse("auth-token-refresh"), {"refresh": old})
        self.assertEqual(res.status_code, 200)
        self.assertNotEqual(res.data["refresh"], old)
        # Rotated token is blacklisted.
        self.assertEqual(self.client.post(reverse("auth-token-refresh"), {"refresh": old}).status_code, 401)

    def test_logout_blacklists_refresh_and_clears_cookie(self):
        self.client.post(reverse("auth-token"), {"username": "ana", "password": "Str0ng-pass-123"}, **WEB)
        cookie_value = self.client.cookies[COOKIE].value
        res = self.client.post(reverse("auth-logout"), **WEB)
        self.assertEqual(res.status_code, 204)
        self.assertEqual(res.cookies[COOKIE].value, "")
        res = self.client.post(reverse("auth-token-refresh"), {"refresh": cookie_value})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["code"], "session_expired")

    def test_invalid_access_token_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")
        self.assertEqual(self.client.get(reverse("profile")).status_code, 401)

    def test_login_is_rate_limited(self):
        url = reverse("auth-token")
        codes = [self.client.post(url, {"username": "ana", "password": "wrong-pass-1"}).status_code for _ in range(11)]
        self.assertEqual(codes[-1], 429)


class ProfileTests(FitMeTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user("ana")

    def test_requires_auth(self):
        self.assertEqual(self.client.get(reverse("profile")).status_code, 401)

    def test_get_and_patch(self):
        self.login(self.user)
        res = self.client.get(reverse("profile"))
        self.assertEqual(res.data["username"], "ana")
        self.assertEqual(res.data["analysis_count"], 0)
        res = self.client.patch(
            reverse("profile"),
            {"display_name": "  Ana  ", "style_notes": "Minimal, neutral tones", "username": "hacker"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["display_name"], "Ana")
        self.assertEqual(res.data["username"], "ana")  # read-only

    def test_patch_validation(self):
        self.make_user("bo")
        self.login(self.user)
        res = self.client.patch(reverse("profile"), {"email": "bo@example.com"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("email", res.data["error"]["fields"])
        res = self.client.patch(reverse("profile"), {"display_name": "x" * 61}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.client.patch(reverse("profile"), {"email": "not-an-email"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_put_not_allowed(self):
        self.login(self.user)
        self.assertEqual(self.client.put(reverse("profile"), {}, format="json").status_code, 405)
