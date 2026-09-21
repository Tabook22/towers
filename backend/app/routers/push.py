"""Web Push subscription management — see services/push.py for the actual send logic."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import PushSubscription, User
from app.schemas import PushSubscriptionCreate, PushUnsubscribe, VapidKeyOut
from app.services.push import get_public_key

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/vapid-public-key", response_model=VapidKeyOut)
def vapid_public_key():
    return VapidKeyOut(public_key=get_public_key())


@router.post("/subscribe", status_code=201)
def subscribe(
    payload: PushSubscriptionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).first()
    if existing:
        existing.user_id = user.id
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
        existing.user_agent = payload.user_agent
    else:
        db.add(
            PushSubscription(
                user_id=user.id,
                endpoint=payload.endpoint,
                p256dh=payload.keys.p256dh,
                auth=payload.keys.auth,
                user_agent=payload.user_agent,
            )
        )
    db.commit()
    return {"ok": True}


@router.post("/unsubscribe", status_code=204)
def unsubscribe(
    payload: PushUnsubscribe,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).delete()
    db.commit()
    return Response(status_code=204)
