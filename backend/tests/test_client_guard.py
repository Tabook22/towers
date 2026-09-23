"""The `client` role's HTTP-layer route allowlist (see app/client_guard.py) — a client login's own
JWT should only ever reach the reports/images/self-service endpoints, everything else 403s before
it reaches a router, regardless of which role-specific checks that router itself would have applied."""
import asyncio

import pytest
from starlette.requests import Request

from app.client_guard import client_role_route_guard
from app.security import create_access_token


def _request(path: str, token: str | None, method: str = "GET", origin: str | None = None) -> Request:
    headers = []
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if origin:
        headers.append((b"origin", origin.encode()))
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": headers,
        "query_string": b"",
    }
    return Request(scope)


async def _call_next_sentinel(request):
    return "ROUTER_REACHED"


def _run_guard(path: str, token: str | None, method: str = "GET"):
    request = _request(path, token, method)
    return asyncio.run(client_role_route_guard(request, _call_next_sentinel))


def test_client_token_is_blocked_from_an_unrelated_route():
    token = create_access_token(subject="acme_client", role="client")
    response = _run_guard("/api/towers", token)
    assert response != "ROUTER_REACHED"
    assert response.status_code == 403


def test_client_token_reaches_the_reports_history_endpoint():
    token = create_access_token(subject="acme_client", role="client")
    response = _run_guard("/api/reports/oetc-line-report/history", token)
    assert response == "ROUTER_REACHED"


def test_client_token_reaches_image_endpoints():
    token = create_access_token(subject="acme_client", role="client")
    assert _run_guard("/api/images/42/file", token) == "ROUTER_REACHED"


def test_client_token_reaches_self_service_auth_routes():
    token = create_access_token(subject="acme_client", role="client")
    assert _run_guard("/api/auth/me", token) == "ROUTER_REACHED"
    assert _run_guard("/api/auth/change-password", token, method="POST") == "ROUTER_REACHED"


def test_admin_token_is_never_restricted_by_this_guard():
    token = create_access_token(subject="the_admin", role="admin")
    assert _run_guard("/api/towers", token) == "ROUTER_REACHED"
    assert _run_guard("/api/teams", token) == "ROUTER_REACHED"


def test_no_token_passes_through_untouched():
    # Login/register/public-branding calls carry no token at all — never this guard's concern.
    assert _run_guard("/api/auth/login", None, method="POST") == "ROUTER_REACHED"


def test_options_preflight_is_never_blocked_even_with_a_client_token():
    token = create_access_token(subject="acme_client", role="client")
    assert _run_guard("/api/towers", token, method="OPTIONS") == "ROUTER_REACHED"


def test_blocked_response_carries_cors_headers_for_a_configured_local_dev_origin():
    """Without this, a cross-origin local dev frontend (different port than the backend) sees an
    opaque browser CORS failure instead of a readable 403 — CORSMiddleware never gets a chance to
    add its own headers to a response this middleware returns directly (see _cors_headers)."""
    from app.config import settings

    token = create_access_token(subject="acme_client", role="client")
    origin = settings.cors_origins[0]
    request = _request("/api/towers", token, origin=origin)
    response = asyncio.run(client_role_route_guard(request, _call_next_sentinel))
    assert response.status_code == 403
    assert response.headers["access-control-allow-origin"] == origin


def test_blocked_response_has_no_cors_header_for_an_unrecognized_origin():
    token = create_access_token(subject="acme_client", role="client")
    request = _request("/api/towers", token, origin="https://not-an-allowed-origin.example")
    response = asyncio.run(client_role_route_guard(request, _call_next_sentinel))
    assert "access-control-allow-origin" not in response.headers
