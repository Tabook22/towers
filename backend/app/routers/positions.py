from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import check_visit_team_access, get_current_user
from app.models import IMAGE_TYPE_CHOICES, Image, Position, User, Visit
from app.routers.images import apply_upload
from app.schemas import ImageOut, PositionOut, PositionUpdate
from app.services.codes import refresh_position_codes
from app.services.id_gen import image_code as compute_image_code

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
