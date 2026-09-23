"""Locks a `client` (customer) login down to only the reports portal, at the HTTP layer rather
than by auditing every existing router.

Most routes in this app deny specific roles (team_member, sometimes team_leader) rather than
allow-listing specific ones, so a brand-new role added to models.UserRole would otherwise silently
fall through to full access on routes never written with it in mind (towers, teams, positions,
settings...). Since a `client` account's own JWT already carries its role (see
security.create_access_token), this middleware decodes just that claim — no DB lookup — and, only
for a request that is one, refuses anything outside the small allow-list below before it ever
reaches a router. Every allow-listed endpoint still does its own client-specific checks inside
(scope, can_edit_reports/can_delete_report_images) — this is a coarse first gate, not a replacement
for those.
"""
from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.security import decode_access_token

CLIENT_ALLOWED_PATH_PREFIXES = (
    "/api/auth/me",
    "/api/auth/change-password",
    "/api/reports/oetc-line-report",
    "/api/images/",
)


async def client_role_route_guard(request: Request, call_next):
    if request.method != "OPTIONS":
        token = _extract_token(request)
        if token:
            payload = decode_access_token(token)
            if payload and payload.get("role") == "client":
                path = request.url.path
                if not any(path.startswith(p) for p in CLIENT_ALLOWED_PATH_PREFIXES):
                    return JSONResponse(status_code=403, content={"detail": "Not enough permissions"}, headers=_cors_headers(request))
    return await call_next(request)


def _cors_headers(request: Request) -> dict[str, str]:
    """CORSMiddleware never gets a chance to add its own headers to a response this middleware
    returns directly (it sits further out in the stack and only decorates responses that come back
    through the normal call_next path) — same-origin production traffic never needs this at all,
    but local dev (frontend and backend on different ports) does, so this refusal reads as a clean
    403 instead of an opaque browser CORS failure."""
    origin = request.headers.get("origin")
    if origin and origin in settings.cors_origins:
        return {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"}
    return {}


def _extract_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return request.query_params.get("token")
