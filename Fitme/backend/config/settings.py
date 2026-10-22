"""Django settings for FitMe.ai.

All secrets and deployment-specific values come from environment variables.
A local `.env` file at the repository root is loaded for development only.
"""

from datetime import timedelta
from pathlib import Path
import os

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
REPO_DIR = BASE_DIR.parent
FRONTEND_DIR = REPO_DIR / "frontend"


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (KEY=VALUE lines). Real env vars always win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


if os.environ.get("FITME_SKIP_DOTENV") != "1":
    _load_dotenv(REPO_DIR / ".env")


def env(key, default=None):
    return os.environ.get(key, default)


def env_bool(key, default=False):
    value = os.environ.get(key)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(key, default):
    value = os.environ.get(key)
    return int(value) if value not in (None, "") else default


def env_float(key, default):
    value = os.environ.get(key)
    return float(value) if value not in (None, "") else default


def env_list(key, default=""):
    return [item.strip() for item in env(key, default).split(",") if item.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)

SECRET_KEY = env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-key-do-not-use-in-production"
    else:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is false.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1" if DEBUG else "")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "accounts",
    "analyses",
    "ai_services",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "config" / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# --- Database -------------------------------------------------------------
# PostgreSQL is the intended database. SQLite is accepted only for quick local
# experiments and is rejected outside DEBUG.
DATABASE_URL = env("DATABASE_URL", "postgres://fitme@localhost:5433/fitme")
DATABASES = {"default": dj_database_url.parse(DATABASE_URL, conn_max_age=60)}
if not DEBUG and DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
    raise ImproperlyConfigured("Production requires PostgreSQL (DATABASE_URL=postgres://...).")

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static frontend & media ---------------------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [FRONTEND_DIR]
WHITENOISE_INDEX_FILE = False

# Uploaded outfit photos are private: they are never served from a public URL.
# The API streams them only to their owner (see analyses.views).
MEDIA_ROOT = Path(env("FITME_MEDIA_ROOT", str(REPO_DIR / "media")))
MEDIA_URL = "/media-private/"  # not routed; present only because Django requires a value

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Upload limits --------------------------------------------------------
FITME_MAX_UPLOAD_BYTES = env_int("FITME_MAX_UPLOAD_BYTES", 8 * 1024 * 1024)
FITME_MIN_IMAGE_SIDE = env_int("FITME_MIN_IMAGE_SIDE", 200)
FITME_MAX_IMAGE_SIDE = env_int("FITME_MAX_IMAGE_SIDE", 8000)
FITME_MAX_IMAGE_PIXELS = env_int("FITME_MAX_IMAGE_PIXELS", 40_000_000)
FITME_STORED_IMAGE_MAX_SIDE = env_int("FITME_STORED_IMAGE_MAX_SIDE", 2048)
FITME_MODEL_IMAGE_MAX_SIDE = env_int("FITME_MODEL_IMAGE_MAX_SIDE", 1280)
FITME_THUMB_SIDE = env_int("FITME_THUMB_SIDE", 400)
DATA_UPLOAD_MAX_MEMORY_SIZE = FITME_MAX_UPLOAD_BYTES + 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = FITME_MAX_UPLOAD_BYTES + 1024 * 1024

# --- AI provider ----------------------------------------------------------
# AI_PROVIDER: "qwen" (OpenAI-compatible endpoint serving Qwen2.5-VL),
# "mock" (development fixture, refused when DEBUG is false), or "none".
AI_PROVIDER = env("AI_PROVIDER", "none").strip().lower()
if AI_PROVIDER == "mock" and not DEBUG and not env_bool("FITME_ALLOW_MOCK_IN_PRODUCTION", False):
    raise ImproperlyConfigured("AI_PROVIDER=mock is disabled when DJANGO_DEBUG is false.")

QWEN = {
    "API_BASE": env("QWEN_API_BASE", "").rstrip("/"),
    "API_KEY": env("QWEN_API_KEY", ""),
    "MODEL": env("QWEN_MODEL", "qwen2.5-vl-72b-instruct"),
    "TIMEOUT_SECONDS": env_float("QWEN_TIMEOUT_SECONDS", 60.0),
    "CONNECT_TIMEOUT_SECONDS": env_float("QWEN_CONNECT_TIMEOUT_SECONDS", 10.0),
    "MAX_TOKENS": env_int("QWEN_MAX_TOKENS", 1200),
    "TEMPERATURE": env_float("QWEN_TEMPERATURE", 0.2),
    "TOP_P": env_float("QWEN_TOP_P", 0.9),
    "JSON_MODE": env_bool("QWEN_JSON_MODE", True),
    "MAX_RETRIES": env_int("QWEN_MAX_RETRIES", 1),
}

# --- REST framework / auth -----------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
    ],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "analyses.pagination.HistoryPagination",
    "PAGE_SIZE": 12,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.ScopedRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "auth": env("FITME_THROTTLE_AUTH", "10/min"),
        "auth_refresh": env("FITME_THROTTLE_REFRESH", "60/min"),
        "analysis_create": env("FITME_THROTTLE_ANALYSIS", "20/hour"),
        "user": env("FITME_THROTTLE_USER", "600/hour"),
    },
}
if DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"].append("rest_framework.renderers.BrowsableAPIRenderer")

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("JWT_ACCESS_MINUTES", 15)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env_int("JWT_REFRESH_DAYS", 7)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# Refresh token lives in an HttpOnly cookie scoped to the auth endpoints.
JWT_REFRESH_COOKIE = {
    "NAME": "fitme_refresh",
    "PATH": "/api/auth/",
    "SAMESITE": "Strict",
    "SECURE": not DEBUG,
    "HTTPONLY": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "FitMe.ai API",
    "DESCRIPTION": "Outfit analysis and styling recommendations powered by Qwen2.5-VL.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

CACHES = {
    "default": {
        "BACKEND": env("DJANGO_CACHE_BACKEND", "django.core.cache.backends.locmem.LocMemCache"),
        "LOCATION": env("DJANGO_CACHE_LOCATION", "fitme"),
    }
}

# --- CORS / CSRF ------------------------------------------------------------
# The frontend is served by Django from the same origin, so no CORS headers are
# emitted at all. Cross-origin browser calls are therefore refused by default.
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

# --- Production hardening -------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
if not DEBUG:
    SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env_int("DJANGO_HSTS_SECONDS", 31536000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
    }

# --- Logging ----------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": env("DJANGO_LOG_LEVEL", "INFO")},
    "loggers": {
        "django.request": {"level": "ERROR"},
        # urllib3 debug logs can include request bodies (base64 images). Keep quiet.
        "urllib3": {"level": "WARNING"},
    },
}
