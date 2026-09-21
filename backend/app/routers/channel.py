"""Live night channel: short ops messages the crew and dispatch share during an outing."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_team_read
from app.models import (
    CHANNEL_KIND_CHOICES,
    CHANNEL_KIND_DEFAULT_BODY,
    LocationPing,
    Team,
    TeamChannelMessage,
    User,
    UserRole,
)
from app.schemas import ChannelMessageCreate, ChannelMessageOut, ChannelUnreadOut
from app.services.archive import build_thumbnail, file_extension, save_upload
from app.services.channel import message_out, resolve_location
from app.services.movement import current_field_date
from app.services.push import notify_new_message

router = APIRouter(tags=["channel"])

ACCEPTED_PHOTO = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}
ACCEPTED_VIDEO = {"video/mp4", "video/webm", "video/quicktime"}
# A generic "send anything" attachment — common office/document formats plus archives. Not a
# security allowlist for executables etc.; deliberately permissive since this is the same kind of
# file a crew might otherwise text/email (a permit PDF, a site diagram, a spreadsheet).
ACCEPTED_FILE = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "application/zip",
    "application/x-zip-compressed",
}


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


def _schedule_push(background_tasks: BackgroundTasks, db: Session, team_id: int, user: User, row: TeamChannelMessage) -> None:
    """Pushes a lock-screen notification to every other signed-in user with the app open — see
    services/push.py. Computed synchronously here (while the request's session is still open) and
    handed to the background task as plain strings, since that task opens its own session."""
    team = db.get(Team, team_id)
    who = user.full_name or user.username
    title = f"{who} · {team.name}" if team else who
    body = row.body or "New message"
    background_tasks.add_task(notify_new_message, user.id, title, body, "/messages")


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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    kind = _kind(payload.kind, user)
    row = _create_row(db, team_id, user, kind, payload.body, payload.tower_id, payload.latitude, payload.longitude)
    _schedule_push(background_tasks, db, team_id, user, row)
    db.commit()
    return message_out(_load_message(db, team_id, row.id))


@router.post("/api/teams/{team_id}/channel/photo", response_model=ChannelMessageOut, status_code=201)
async def post_channel_photo(
    team_id: int,
    background_tasks: BackgroundTasks,
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
    _schedule_push(background_tasks, db, team_id, user, row)
    db.commit()
    return message_out(_load_message(db, team_id, row.id))


@router.post("/api/teams/{team_id}/channel/voice", response_model=ChannelMessageOut, status_code=201)
async def post_channel_voice(
    team_id: int,
    background_tasks: BackgroundTasks,
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
    _schedule_push(background_tasks, db, team_id, user, row)
    db.commit()
    return message_out(_load_message(db, team_id, row.id))


@router.post("/api/teams/{team_id}/channel/video", response_model=ChannelMessageOut, status_code=201)
async def post_channel_video(
    team_id: int,
    background_tasks: BackgroundTasks,
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
        raise HTTPException(status_code=400, detail="Video is empty")
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail=f"Video is too large (max {settings.max_upload_size_mb} MB)")
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    if ctype not in ACCEPTED_VIDEO:
        raise HTTPException(status_code=400, detail="Send a video (MP4/WebM/MOV)")
    row = _create_row(db, team_id, user, kind, body, tower_id, latitude, longitude, allow_empty=True)
    ext = file_extension(file.filename, ctype)
    stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    rel = f"{team_id}/{row.field_date.isoformat()}/{stamp}{ext}"
    save_upload(raw, rel, base_dir=settings.channel_dir)
    row.video_path = rel
    row.video_content_type = ctype
    row.video_original_filename = file.filename
    row.duration_seconds = duration_seconds
    if not row.body:
        row.body = "Video"
    _schedule_push(background_tasks, db, team_id, user, row)
    db.commit()
    return message_out(_load_message(db, team_id, row.id))


@router.post("/api/teams/{team_id}/channel/file", response_model=ChannelMessageOut, status_code=201)
async def post_channel_file(
    team_id: int,
    background_tasks: BackgroundTasks,
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
        raise HTTPException(status_code=400, detail="File is empty")
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File is too large (max {settings.max_upload_size_mb} MB)")
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    if ctype not in ACCEPTED_FILE:
        raise HTTPException(status_code=400, detail="That file type isn't supported")
    row = _create_row(db, team_id, user, kind, body, tower_id, latitude, longitude, allow_empty=True)
    ext = file_extension(file.filename, ctype)
    stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    rel = f"{team_id}/{row.field_date.isoformat()}/{stamp}{ext}"
    save_upload(raw, rel, base_dir=settings.channel_dir)
    row.file_path = rel
    row.file_content_type = ctype
    row.file_original_filename = file.filename
    row.file_size = len(raw)
    if not row.body:
        row.body = file.filename or "File"
    _schedule_push(background_tasks, db, team_id, user, row)
    db.commit()
    return message_out(_load_message(db, team_id, row.id))


@router.get("/api/teams/{team_id}/channel/{message_id}/photo")
def channel_photo(
    team_id: int,
    message_id: int,
    thumb: bool = Query(default=False),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
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
    _user: User = Depends(get_current_user),
):
    row = _load_message(db, team_id, message_id)
    if not row.audio_path:
        raise HTTPException(status_code=404, detail="No recording")
    path = settings.channel_dir / row.audio_path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Recording file missing")
    return FileResponse(path, media_type=row.audio_content_type or "audio/webm")


@router.get("/api/teams/{team_id}/channel/{message_id}/video")
def channel_video(
    team_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    row = _load_message(db, team_id, message_id)
    if not row.video_path:
        raise HTTPException(status_code=404, detail="No video")
    path = settings.channel_dir / row.video_path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Video file missing")
    return FileResponse(path, media_type=row.video_content_type or "video/mp4")


@router.get("/api/teams/{team_id}/channel/{message_id}/file")
def channel_file(
    team_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    row = _load_message(db, team_id, message_id)
    if not row.file_path:
        raise HTTPException(status_code=404, detail="No file")
    path = settings.channel_dir / row.file_path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(
        path,
        media_type=row.file_content_type or "application/octet-stream",
        filename=row.file_original_filename or path.name,
    )


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
    _viewer: User = Depends(get_current_user),
):
    """One open company channel: every crew's traffic, newest last — every signed-in user can see
    it (not just admin/reviewer), same as the Messages page. Posting is still per-team
    (see post_channel and friends), just reading spans every team."""
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


@router.get("/api/tracking/channel/unread-count", response_model=ChannelUnreadOut)
def channel_unread_count(
    after_id: int = Query(default=0),
    field_date: dt.date | None = Query(default=None),
    db: Session = Depends(get_db),
    _viewer: User = Depends(get_current_user),
):
    """A cheap poll target for the Messages nav badge — counts only, no message bodies/media, so
    every page can afford to check this often without pulling the full feed."""
    day = field_date or current_field_date()
    latest_id = db.query(func.max(TeamChannelMessage.id)).filter(TeamChannelMessage.field_date == day).scalar()
    unread = 0
    if latest_id and latest_id > after_id:
        unread = (
            db.query(func.count(TeamChannelMessage.id))
            .filter(TeamChannelMessage.field_date == day, TeamChannelMessage.id > after_id)
            .scalar()
            or 0
        )
    return ChannelUnreadOut(unread_count=unread, latest_id=latest_id)
