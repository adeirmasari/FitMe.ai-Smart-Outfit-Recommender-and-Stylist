"""Uniform API error envelope.

Every error response has the shape::

    {"error": {"code": "<machine_code>", "message": "<safe text>", "fields": {...}}}

`fields` is present only for validation errors.
"""

import logging

from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)

_DEFAULT_CODES = {
    status.HTTP_400_BAD_REQUEST: "invalid_request",
    status.HTTP_401_UNAUTHORIZED: "not_authenticated",
    status.HTTP_403_FORBIDDEN: "permission_denied",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: "payload_too_large",
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
}


def _first_message(detail):
    if isinstance(detail, list) and detail:
        return _first_message(detail[0])
    if isinstance(detail, dict) and detail:
        return _first_message(next(iter(detail.values())))
    return str(detail)


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled API error in %s", context.get("view").__class__.__name__)
        return Response(
            {"error": {"code": "server_error", "message": "Something went wrong on our side. Please try again."}},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    data = response.data
    if isinstance(exc, exceptions.ValidationError):
        fields = data if isinstance(data, dict) else {"non_field_errors": data}
        message = _first_message(fields.get("non_field_errors") or fields)
        response.data = {"error": {"code": "validation_error", "message": message, "fields": fields}}
        return response

    code = getattr(exc, "default_code", None) or _DEFAULT_CODES.get(response.status_code, "error")
    if isinstance(data, dict) and "code" in data and isinstance(data["code"], str):
        code = data["code"]
    if isinstance(exc, exceptions.Throttled):
        code = "rate_limited"
        message = "Too many requests. Please wait a moment and try again."
        if exc.wait:
            message = f"Too many requests. Try again in {int(exc.wait) + 1} seconds."
    else:
        message = _first_message(data.get("detail", data) if isinstance(data, dict) else data)
    response.data = {"error": {"code": code, "message": message}}
    return response
