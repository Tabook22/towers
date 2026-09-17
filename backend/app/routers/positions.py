from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import check_visit_team_access, get_current_user
from app.models import IMAGE_TYPE_CHOICES, Image, Position, User, Visit
from app.routers.images import apply_upload
from app.routers.teams import ACCEPTED_AUDIO_TYPES
from app.schemas import ImageOut, PositionOut, PositionUpdate
from app.services.archive import file_extension, save_upload
from app.services.codes import refresh_position_codes
from app.services.id_gen import image_code as compute_image_code
from app.services.transcribe import transcribe_audio

router = APIRouter(prefix="/api/positions", tags=["positions"])


def _load_position(db: Session, position_id: int, user: User) -> Position:
    pos = (
        db.query(Position)
        .options(joinedload(Position.images), joinedload(Position.visit).joinedload(Visit.tower))
        .filter(Position.id == position_id)
        .first()
    )
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")
    check_visit_team_access(pos.visit, user)
    return pos


@router.get("/{position_id}", response_model=PositionOut)
def get_position(position_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _load_position(db, position_id, user)


@router.patch("/{position_id}", response_model=PositionOut)
def update_position(
    position_id: int, payload: PositionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    pos = _load_position(db, position_id, user)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(pos, k, v)
    db.flush()
    refresh_position_codes(pos)
    db.commit()
    db.refresh(pos)
    return pos


@router.post("/{position_id}/images", response_model=ImageOut, status_code=201)
async def add_extra_image(
    position_id: int,
    image_type: str = Form(...),
    file: UploadFile = File(...),
    capture_date: str | None = Form(default=None),
    capture_time: str | None = Form(default=None),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Adds a supplementary image of `image_type` beyond the position's original one-per-type
    baseline (sequence 1) — e.g. a second TH Close shot from another angle. Doesn't touch the
    baseline slot or evidence/roll-up counting (see visit_rollup); purely additional evidence."""
    pos = _load_position(db, position_id, user)
    if image_type not in IMAGE_TYPE_CHOICES:
        raise HTTPException(status_code=400, detail=f"image_type must be one of {IMAGE_TYPE_CHOICES}")
    if not pos.direction:
        raise HTTPException(status_code=400, detail="Set the position's Direction before uploading images")

    existing = [i for i in pos.images if i.image_type == image_type]
    next_seq = max((i.sequence for i in existing), default=0) + 1
    base_code = compute_image_code(pos.position_code, pos.ohl, pos.phase, pos.string, pos.direction, image_type)
    new_code = base_code if next_seq == 1 else f"{base_code}-{next_seq}"

    img = Image(position_id=pos.id, image_type=image_type, image_code=new_code, sequence=next_seq)
    db.add(img)
    db.flush()
    db.refresh(img)
    img.position = pos  # apply_upload needs img.position.visit.tower without an extra query

    raw = await file.read()
    await apply_upload(img, raw, file.filename, file.content_type, capture_date, capture_time, latitude, longitude)

    db.commit()
    db.refresh(img)
    return img


@router.post("/{position_id}/voice", response_model=PositionOut)
async def add_voice_note(
    position_id: int,
    file: UploadFile = File(...),
    duration_seconds: float | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Records this exact insulator's voice note — always tied to this position_id, never to the
    visit as a whole. Re-recording replaces the previous audio and clears its transcript; it
    never touches inspector_notes or any other position's recording."""
    pos = _load_position(db, position_id, user)
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ACCEPTED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {file.content_type}")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty recording")
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail="Recording is too large")

    old_path = pos.voice_note_path
    ext = file_extension(file.filename, content_type)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    rel_path = f"{position_id}/{stamp}{ext}"
    save_upload(raw, rel_path, base_dir=settings.voice_notes_dir)

    pos.voice_note_path = rel_path
    pos.voice_note_content_type = content_type
    pos.voice_note_original_filename = file.filename
    pos.voice_note_duration_seconds = duration_seconds
    pos.voice_note_transcript = None
    db.commit()
    db.refresh(pos)

    if old_path:
        try:
            (settings.voice_notes_dir / old_path).unlink(missing_ok=True)
        except OSError:
            pass
    return pos


@router.get("/{position_id}/voice/audio")
def get_voice_note_audio(position_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pos = _load_position(db, position_id, user)
    if not pos.voice_note_path:
        raise HTTPException(status_code=404, detail="No voice note recorded for this insulator")
    path = settings.voice_notes_dir / pos.voice_note_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file missing")
    return FileResponse(
        path,
        media_type=pos.voice_note_content_type or "application/octet-stream",
        filename=pos.voice_note_original_filename or path.name,
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/{position_id}/voice/transcribe", response_model=PositionOut)
def transcribe_voice_note(position_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Converts this position's own recording to text — never another position's audio. The
    transcript is stored separately from inspector_notes so a typed note is never overwritten."""
    pos = _load_position(db, position_id, user)
    if not pos.voice_note_path:
        raise HTTPException(status_code=404, detail="No voice note recorded for this insulator")
    path = settings.voice_notes_dir / pos.voice_note_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file missing")
    raw = path.read_bytes()
    text, err = transcribe_audio(
        raw,
        pos.voice_note_original_filename or path.name,
        pos.voice_note_content_type or "application/octet-stream",
    )
    if err or not text:
        raise HTTPException(status_code=502, detail=err or "Could not convert this recording to text")
    pos.voice_note_transcript = text
    db.commit()
    db.refresh(pos)
    return pos


@router.delete("/{position_id}/voice", response_model=PositionOut)
def delete_voice_note(position_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pos = _load_position(db, position_id, user)
    if pos.voice_note_path:
        try:
            (settings.voice_notes_dir / pos.voice_note_path).unlink(missing_ok=True)
        except OSError:
            pass
    pos.voice_note_path = None
    pos.voice_note_content_type = None
    pos.voice_note_original_filename = None
    pos.voice_note_duration_seconds = None
    pos.voice_note_transcript = None
    db.commit()
    db.refresh(pos)
    return pos
