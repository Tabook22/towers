from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import check_visit_team_access, get_current_user
from app.models import IMAGE_TYPE_CHOICES, Image, Position, ReportImage, ThermalEditGrant, User, Visit, VisitPhoto
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
    data = payload.model_dump(exclude_unset=True)
    string = data.get("string", pos.string)
    count = data.get("string_count", pos.string_count)
    if ("string" in data or "string_count" in data) and (string not in ("S1", "S2") or (count == "Single" and string != "S1")):
        raise HTTPException(status_code=422, detail="A one-string position must use S1. Choose a valid string before saving.")
    direction = data.get("direction", pos.direction)
    ohl = data.get("ohl", pos.ohl)
    phase = data.get("phase", pos.phase)
    if (ohl, phase, string, direction) != (pos.ohl, pos.phase, pos.string, pos.direction):
        conflict = db.query(Position).filter(Position.visit_id == pos.visit_id, Position.ohl == ohl,
            Position.phase == phase, Position.string == string, Position.direction == direction,
            Position.id != pos.id).first()
        if conflict:
            raise HTTPException(status_code=409, detail="This OHL, phase, string and direction already have a position. Open that position instead; no data has been overwritten.")
    if "string" in data or "string_count" in data:
        data["tower_proximity"] = ("Outer" if string == "S1" else "Inner") if count == "Double" else None
    for k, v in data.items():
        setattr(pos, k, v)
    db.flush()
    refresh_position_codes(pos)
    db.commit()
    db.refresh(pos)
    return pos


@router.delete("/{position_id}", status_code=204)
def delete_position(position_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Delete one inspection and its evidence, allowing its slot to be added again."""
    pos = _load_position(db, position_id, user)
    files = [(settings.voice_notes_dir, pos.voice_note_path)]
    for img in pos.images:
        files.extend([
            (settings.images_dir, img.file_path),
            (settings.thumbnails_dir, img.thumbnail_path),
            (settings.images_dir, img.annotated_path),
            (settings.thumbnails_dir, img.annotated_thumbnail_path),
        ])
    image_ids = [img.id for img in pos.images]
    # Saved report documents remain intact; remove their links to deleted live evidence.
    db.query(ReportImage).filter(ReportImage.position_id == pos.id).delete(synchronize_session="fetch")
    db.query(ThermalEditGrant).filter(ThermalEditGrant.image_id.in_(image_ids)).delete(synchronize_session="fetch")
    # Ad-hoc visit photos belong to the visit. Keep them, removing only the optional tag.
    db.query(VisitPhoto).filter(VisitPhoto.position_id == pos.id).update(
        {VisitPhoto.position_id: None}, synchronize_session="fetch"
    )
    db.delete(pos)
    db.commit()
    # Only remove files after a successful commit, and only within their storage roots.
    for base, relative in files:
        if not relative:
            continue
        path = (base / relative).resolve()
        if not path.is_relative_to(base.resolve()):
            continue
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logging.getLogger(__name__).warning("Could not remove deleted position file %s", path, exc_info=True)


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
