"""Live night channel: short ops messages the crew and dispatch share during an outing."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_role, require_team_read
from app.models import (
    CHANNEL_KIND_CHOICES,
    CHANNEL_KIND_DEFAULT_BODY,
    LocationPing,
    Team,
    TeamChannelMessage,
    User,
    UserRole,
)
from app.schemas import ChannelMessageCreate, ChannelMessageOut
from app.services.archive import build_thumbnail, file_extension, save_upload
from app.services.channel import message_out, resolve_location
from app.services.movement import current_field_date

router = APIRouter(tags=["channel"])

ACCEPTED_PHOTO = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}


def _load_team(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


def _kind(raw: str | None, user: User) -> str:
    kind = (raw or "").strip().lower() or "note"
    if kind not in CHANNEL_KIND_CHOICES:
        raise HTTPException(status_code=400, detail=f"kind must be one of {CHANNEL_KIND_CHOICES}")
    if kind == "note" and user.role in (UserRole.ADMIN.value, UserRole.REVIEWER.value):
        return "dispatch"
    return kind


def _body(kind: str, body: str | None) -> str:
    text = (body or "").strip()
    if text:
        return text
    return CHANNEL_KIND_DEFAULT_BODY.get(kind, "")


def _fallback_gps(db: Session, user: User, latitude: float | None, longitude: float | None) -> tuple[float | None, float | None]:
    if latitude is not None and longitude is not None:
        return latitude, longitude
    ping = (
        db.query(LocationPing)
        .filter(LocationPing.user_id == user.id)
        .order_by(LocationPing.recorded_at.desc())
        .first()
    )
    if ping:
        return ping.latitude, ping.longitude
    return latitude, longitude


def _load_message(db: Session, team_id: int, message_id: int) -> TeamChannelMessage:
    row = (
        db.query(TeamChannelMessage)
        .options(
            joinedload(TeamChannelMessage.author),
            joinedload(TeamChannelMessage.tower),
            joinedload(TeamChannelMessage.team),
        )
        .filter(TeamChannelMessage.id == message_id, TeamChannelMessage.team_id == team_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    return row


@router.get("/api/teams/{team_id}/channel", response_model=list[ChannelMessageOut])
def list_channel(
    team_id: int,
    field_date: dt.date | None = Query(default=None),
    after_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    _load_team(db, team_id)
    day = field_date or current_field_date()
    q = (
        db.query(TeamChannelMessage)
        .options(
            joinedload(TeamChannelMessage.author),
            joinedload(TeamChannelMessage.tower),
            joinedload(TeamChannelMessage.team),
        )
        .filter(TeamChannelMessage.team_id == team_id, TeamChannelMessage.field_date == day)
    )
    if after_id:
        q = q.filter(TeamChannelMessage.id > after_id)
    rows = q.order_by(TeamChannelMessage.id.asc()).limit(200).all()
    return [message_out(r) for r in rows]


def _create_row(
    db: Session,
    team_id: int,
    user: User,
    kind: str,
    body: str,
    tower_id: int | None,
    latitude: float | None,
    longitude: float | None,
    allow_empty: bool = False,
) -> TeamChannelMessage:
    _load_team(db, team_id)
    lat, lng = _fallback_gps(db, user, latitude, longitude)
    tower_pk, visit_id, lat, lng = resolve_location(db, team_id, tower_id, lat, lng)
    row = TeamChannelMessage(
        team_id=team_id,
        field_date=current_field_date(),
        kind=kind,
        body=_body(kind, body),
        tower_pk=tower_pk,
        visit_id=visit_id,
        latitude=lat,
        longitude=lng,
        created_by=user.id,
    )
    if not row.body and kind in ("note", "dispatch") and not allow_empty:
        raise HTTPException(status_code=400, detail="Type a message, or pick Access / Hold / Skip / Hotspot / Help")
    db.add(row)
    db.flush()
    return row


@router.post("/api/teams/{team_id}/channel", response_model=ChannelMessageOut, status_code=201)
def post_channel(
    team_id: int,
    payload: ChannelMessageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    kind = _kind(payload.kind, user)
    row = _create_row(db, team_id, user, kind, payload.body, payload.tower_id, payload.latitude, payload.longitude)
    db.commit()
    return message_out(_load_message(db, team_id, row.id))


@router.post("/api/teams/{team_id}/channel/photo", response_model=ChannelMessageOut, status_code=201)
async def post_channel_photo(
    team_id: int,
    file: UploadFile = File(...),
    kind: str = Form("note"),
    body: str = Form(""),
    tower_id: int | None = Form(None),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    kind = _kind(kind, user)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Photo is empty")
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail="Photo is too large")
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    if ctype not in ACCEPTED_PHOTO and not (file.filename or "").lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        raise HTTPException(status_code=400, detail="Send a photo (JPEG/PNG/WebP)")
    row = _create_row(db, team_id, user, kind, body, tower_id, latitude, longitude, allow_empty=True)
    ext = file_extension(file.filename, ctype or "image/jpeg")
    stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    rel = f"{team_id}/{row.field_date.isoformat()}/{stamp}{ext}"
    save_upload(raw, rel, base_dir=settings.channel_dir)
    thumb = build_thumbnail(rel, source_base_dir=settings.channel_dir, thumb_base_dir=settings.channel_dir / "thumbs")
    row.photo_path = rel
    row.photo_thumb_path = thumb
    row.photo_content_type = ctype or "image/jpeg"
    row.photo_original_filename = file.filename
    if not row.body:
        row.body = "Photo"
    db.commit()
    return message_out(_load_message(db, team_id, row.id))


@router.post("/api/teams/{team_id}/channel/voice", response_model=ChannelMessageOut, status_code=201)
async def post_channel_voice(
    team_id: int,
    file: UploadFile = File(...),
    kind: str = Form("note"),
    body: str = Form(""),
    duration_seconds: float | None = Form(None),
    tower_id: int | None = Form(None),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    kind = _kind(kind, user)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Recording is empty")
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    row = _create_row(db, team_id, user, kind, body, tower_id, latitude, longitude, allow_empty=True)
    ext = file_extension(file.filename, ctype or "audio/webm")
    stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    rel = f"{team_id}/{row.field_date.isoformat()}/{stamp}{ext}"
    save_upload(raw, rel, base_dir=settings.channel_dir)
    row.audio_path = rel
    row.audio_content_type = ctype or "audio/webm"
    row.duration_seconds = duration_seconds
    if not row.body:
        row.body = "Voice note"
    db.commit()
    return message_out(_load_message(db, team_id, row.id))


@router.get("/api/teams/{team_id}/channel/{message_id}/photo")
def channel_photo(
    team_id: int,
    message_id: int,
    thumb: bool = Query(default=False),
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    row = _load_message(db, team_id, message_id)
    rel = row.photo_thumb_path if thumb and row.photo_thumb_path else row.photo_path
    if not rel:
        raise HTTPException(status_code=404, detail="No photo")
    base = settings.channel_dir / "thumbs" if thumb and row.photo_thumb_path else settings.channel_dir
    path = base / rel
    if not path.is_file():
        path = settings.channel_dir / rel
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Photo file missing")
    return FileResponse(path, media_type=row.photo_content_type or "image/jpeg")


@router.get("/api/teams/{team_id}/channel/{message_id}/audio")
def channel_audio(
    team_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    row = _load_message(db, team_id, message_id)
    if not row.audio_path:
        raise HTTPException(status_code=404, detail="No recording")
    path = settings.channel_dir / row.audio_path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Recording file missing")
    return FileResponse(path, media_type=row.audio_content_type or "audio/webm")


@router.delete("/api/teams/{team_id}/channel/{message_id}", status_code=204)
def delete_channel_message(
    team_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    row = _load_message(db, team_id, message_id)
    if user.role not in (UserRole.ADMIN.value, UserRole.REVIEWER.value, UserRole.TEAM_LEADER.value) and row.created_by != user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own messages")
    if user.role == UserRole.TEAM_LEADER.value and user.team_id != team_id:
        raise HTTPException(status_code=403, detail="Not your team")
    db.delete(row)
    db.commit()
    return None


@router.get("/api/tracking/channel", response_model=list[ChannelMessageOut])
def tracking_channel_feed(
    field_date: dt.date | None = Query(default=None),
    team_id: int | None = Query(default=None),
    limit: int = Query(default=150, ge=1, le=300),
    db: Session = Depends(get_db),
    _viewer: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """Dispatch inbox: tonight's channel traffic across crews, newest last."""
    day = field_date or current_field_date()
    q = (
        db.query(TeamChannelMessage)
        .options(
            joinedload(TeamChannelMessage.author),
            joinedload(TeamChannelMessage.tower),
            joinedload(TeamChannelMessage.team),
        )
        .filter(TeamChannelMessage.field_date == day)
    )
    if team_id is not None:
        q = q.filter(TeamChannelMessage.team_id == team_id)
    rows = q.order_by(TeamChannelMessage.id.desc()).limit(limit).all()
    rows.reverse()
    return [message_out(r) for r in rows]
