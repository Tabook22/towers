"""Web Push notifications for new channel messages (see routers/channel.py's post endpoints and
routers/push.py). The VAPID key pair identifies this app's server to the browser push services
(Chrome/Firefox/Edge's, or Apple's once a PWA is added to an iOS home screen) — it's generated
once and cached under storage/push/ rather than baked into source, so each deployment (local dev,
the VPS) has its own, same as any other environment-local file under storage/."""
from __future__ import annotations

import json
import logging
import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush

from app.config import settings
from app.database import SessionLocal
from app.models import PushSubscription

logger = logging.getLogger(__name__)

_PRIVATE_KEY_PATH = settings.push_dir / "vapid_private.pem"
_PUBLIC_KEY_PATH = settings.push_dir / "vapid_public.txt"


def _generate_and_save() -> tuple[str, str]:
    vapid = Vapid02()
    vapid.generate_keys()
    private_pem = vapid.private_pem().decode()
    raw_public = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    public_b64 = base64.urlsafe_b64encode(raw_public).rstrip(b"=").decode()
    _PRIVATE_KEY_PATH.write_text(private_pem)
    _PUBLIC_KEY_PATH.write_text(public_b64)
    return private_pem, public_b64


def get_vapid_keys() -> tuple[str, str]:
    """Returns (private_pem, public_key_b64url), generating and persisting a pair on first call."""
    if _PRIVATE_KEY_PATH.exists() and _PUBLIC_KEY_PATH.exists():
        return _PRIVATE_KEY_PATH.read_text(), _PUBLIC_KEY_PATH.read_text().strip()
    return _generate_and_save()


def get_public_key() -> str:
    return get_vapid_keys()[1]


def send_to_subscription(sub: PushSubscription, payload: dict) -> bool:
    """True if the send succeeded, or the failure looks transient/unexpected (kept for a retry
    next time); False if the subscription is confirmably dead — either the push service rejected
    it as gone (404/410), or its stored keys are malformed and could never work. One bad row must
    never abort the whole batch: notify_new_message calls this per-subscription specifically so a
    single crash-prone row can't stop everyone else on the team from being notified."""
    get_vapid_keys()  # ensures the key file exists (generates it on first call)
    try:
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=json.dumps(payload),
            # A file path, not the PEM text — pywebpush's webpush() only parses full PEM headers
            # correctly via Vapid.from_file(); its from_string() fallback expects bare base64url
            # DER with no "-----BEGIN...-----" wrapper, so handing it PEM content directly raises
            # a ValueError deep in py_vapid on every single send.
            vapid_private_key=str(_PRIVATE_KEY_PATH),
            vapid_claims={"sub": settings.vapid_subject},
            ttl=60,
        )
        return True
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (404, 410):
            return False
        logger.warning("Push send failed (endpoint=%s): %s", sub.endpoint[:60], exc)
        return True
    except (ValueError, KeyError) as exc:
        # Malformed p256dh/auth (e.g. truncated on write, or never valid) — deserializing the key
        # raises here rather than through WebPushException, and will never succeed on retry.
        logger.warning("Push subscription looks malformed, dropping it (endpoint=%s): %s", sub.endpoint[:60], exc)
        return False
    except Exception as exc:  # noqa: BLE001 — a genuinely unexpected failure must not crash the batch
        logger.warning("Unexpected push failure (endpoint=%s): %s", sub.endpoint[:60], exc)
        return True


def notify_new_message(exclude_user_id: int | None, title: str, body: str, url: str = "/messages") -> None:
    """Runs as a FastAPI BackgroundTask (see routers/channel.py) — opens its own DB session rather
    than reusing the request's, since that one is already closed by the time background tasks run."""
    db = SessionLocal()
    try:
        subs = db.query(PushSubscription).all()
        payload = {"title": title, "body": body, "url": url}
        dead_ids: list[int] = []
        for sub in subs:
            if exclude_user_id is not None and sub.user_id == exclude_user_id:
                continue
            try:
                if not send_to_subscription(sub, payload):
                    dead_ids.append(sub.id)
            except Exception as exc:  # noqa: BLE001 — belt-and-suspenders: never let one row stop the rest
                logger.warning("Push send crashed unexpectedly (endpoint=%s): %s", sub.endpoint[:60], exc)
        if dead_ids:
            db.query(PushSubscription).filter(PushSubscription.id.in_(dead_ids)).delete(synchronize_session=False)
            db.commit()
    finally:
        db.close()
