"""Authentication endpoints.

Token strategy (see README "Authentication & token storage"):
* The access token (15 min) is returned in the JSON body. The web client keeps
  it in memory only.
* The refresh token is set as an HttpOnly, SameSite=Strict cookie scoped to
  /api/auth/. Browser clients identify themselves with `X-FitMe-Client: web`
  and never see the refresh token in JavaScript.
* Non-browser API clients (no header) also receive `refresh` in the body, which
  matches SimpleJWT's standard contract.
* Cookie-based refresh/logout requires the custom header. A cross-site page
  cannot send it without a CORS preflight, which this API never approves.
"""

from django.conf import settings
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import permissions, status
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Profile
from .serializers import (
    AccessTokenResponseSerializer,
    LoginSerializer,
    ProfileSerializer,
    RefreshInputSerializer,
    RegisterSerializer,
    UserSummarySerializer,
)

WEB_CLIENT_HEADER = "HTTP_X_FITME_CLIENT"


def _is_web_client(request):
    return request.META.get(WEB_CLIENT_HEADER) == "web"


def _access_lifetime_seconds():
    return int(settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds())


def _set_refresh_cookie(response, refresh_token):
    cfg = settings.JWT_REFRESH_COOKIE
    response.set_cookie(
        cfg["NAME"],
        str(refresh_token),
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        path=cfg["PATH"],
        secure=cfg["SECURE"],
        httponly=cfg["HTTPONLY"],
        samesite=cfg["SAMESITE"],
    )


def _clear_refresh_cookie(response):
    cfg = settings.JWT_REFRESH_COOKIE
    response.delete_cookie(cfg["NAME"], path=cfg["PATH"], samesite=cfg["SAMESITE"])


def _token_response(request, access, refresh, user=None, status_code=status.HTTP_200_OK):
    body = {"access": str(access), "access_expires_in": _access_lifetime_seconds()}
    if user is not None:
        body["user"] = UserSummarySerializer(user).data
    web = _is_web_client(request)
    if not web:
        body["refresh"] = str(refresh)
    response = Response(body, status=status_code)
    if web:
        _set_refresh_cookie(response, refresh)
    return response


def _incoming_refresh(request):
    """Body token first (API clients); cookie only for identified web clients."""
    token = request.data.get("refresh") if hasattr(request, "data") else None
    if token:
        return token
    if _is_web_client(request):
        return request.COOKIES.get(settings.JWT_REFRESH_COOKIE["NAME"])
    return None


class PublicAuthView(APIView):
    """No credentials required, but failures still answer 401 (not DRF's default 403)."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get_authenticate_header(self, request):
        return 'Bearer realm="api"'


class RegisterView(PublicAuthView):
    throttle_scope = "auth"

    @extend_schema(tags=["auth"], request=RegisterSerializer, responses={201: AccessTokenResponseSerializer})
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        return _token_response(request, refresh.access_token, refresh, user=user, status_code=status.HTTP_201_CREATED)


class LoginView(PublicAuthView):
    throttle_scope = "auth"

    @extend_schema(
        tags=["auth"],
        request=LoginSerializer,
        responses={200: AccessTokenResponseSerializer, 401: OpenApiResponse(description="Invalid credentials")},
    )
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except AuthenticationFailed:
            raise AuthenticationFailed("Incorrect username/email or password.", code="invalid_credentials")
        refresh = RefreshToken(serializer.validated_data["refresh"])
        return _token_response(request, serializer.validated_data["access"], refresh, user=serializer.user)


class RefreshView(PublicAuthView):
    throttle_scope = "auth_refresh"

    @extend_schema(
        tags=["auth"],
        request=RefreshInputSerializer,
        responses={200: AccessTokenResponseSerializer, 401: OpenApiResponse(description="Missing/expired refresh token")},
    )
    def post(self, request):
        token = _incoming_refresh(request)
        if not token:
            raise AuthenticationFailed("Your session has ended. Please sign in again.", code="session_expired")
        serializer = TokenRefreshSerializer(data={"refresh": token})
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, ValidationError, AuthenticationFailed):
            response = Response(
                {"error": {"code": "session_expired", "message": "Your session has ended. Please sign in again."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            if _is_web_client(request):
                _clear_refresh_cookie(response)
            return response
        data = serializer.validated_data
        return _token_response(request, data["access"], data.get("refresh", token))


class LogoutView(PublicAuthView):

    @extend_schema(tags=["auth"], request=RefreshInputSerializer, responses={204: None})
    def post(self, request):
        token = _incoming_refresh(request)
        if token:
            try:
                RefreshToken(token).blacklist()
            except TokenError:
                pass  # already invalid; logging out is still successful
        response = Response(status=status.HTTP_204_NO_CONTENT)
        _clear_refresh_cookie(response)
        return response


@extend_schema(tags=["profile"])
class ProfileView(RetrieveUpdateAPIView):
    serializer_class = ProfileSerializer
    http_method_names = ["get", "patch", "options"]

    def get_object(self):
        profile, _ = Profile.objects.select_related("user").get_or_create(user=self.request.user)
        return profile
