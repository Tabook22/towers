from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import check_visit_team_access, effective_team_id, get_current_user
from app.models import (
    IMAGE_TYPE_CHOICES,
    OHL_CHOICES,
    PHASE_CHOICES,
    STRING_CHOICES,
    Image,
    Position,
    Tower,
    User,
    UserRole,
    Visit,
    VisitPhoto,
)
from app.routers.images import apply_upload
from app.schemas import (
    ImageOut,
    VisitCreate,
    VisitDetail,
    VisitOut,
    VisitPhotoOut,
    VisitPhotoPromote,
    VisitPhotoUpdate,
    VisitRollup,
    VisitUpdate,
)
from app.services.archive import (
    ACCEPTED_IMAGE_CONTENT_TYPES,
    build_thumbnail,
    extract_exif_gps_datetime,
    file_extension,
    save_upload,
)
from app.services.codes import refresh_position_codes
from app.services.id_gen import slugify_tower_id
from app.services.rollup import visit_rollup

router = APIRouter(prefix="/api/visits", tags=["visits"])


def _load_visit(db: Session, visit_id: int) -> Visit:
    visit = (
        db.query(Visit)
        .options(
            joinedload(Visit.positions).joinedload(Position.images),
            joinedload(Visit.tower),
            joinedload(Visit.team),
            joinedload(Visit.photos),
            joinedload(Visit.assigned_member),
        )
        .filter(Visit.id == visit_id)
        .first()
    )
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    return visit


def attach_rollup(visit: Visit, detail: bool = False) -> VisitOut:
    """Builds the response for one visit — rollup stats plus, when this visit is also a team's
    mission (team_id set), its team name, mission number, and who it's assigned to. Shared by this
    router and routers/teams.py's mission endpoints, since a "mission" is just a Visit viewed
    team-first."""
    out = (VisitDetail if detail else VisitOut).model_validate(visit)
    out.rollup = VisitRollup(**visit_rollup(visit))
    out.team_name = visit.team.name if visit.team else None
    out.assigned_member_name = (
        visit.assigned_member.full_name or visit.assigned_member.username if visit.assigned_member else None
    )
    out.photo_count = len(visit.photos)
    return out


@router.get("", response_model=list[VisitOut])
def list_visits(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    tower_id: int | None = None,
    team_id: int | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    skip: int = 0,
    limit: int = 100,
):
    q = db.query(Visit).options(
        joinedload(Visit.positions).joinedload(Position.images),
        joinedload(Visit.tower),
        joinedload(Visit.team),
        joinedload(Visit.photos),
        joinedload(Visit.assigned_member),
    )
    if user.role in (UserRole.TEAM_MEMBER.value, UserRole.TEAM_LEADER.value):
        tid = effective_team_id(db, user)
        q = q.filter(Visit.team_id == tid) if tid else q.filter(False)
    elif team_id:
        q = q.filter(Visit.team_id == team_id)
    if tower_id:
        q = q.filter(Visit.tower_id == tower_id)
    if status_filter:
        q = q.filter(Visit.status == status_filter)
    order = Visit.mission_seq.asc() if team_id else Visit.inspection_date.desc().nullslast()
    visits = q.order_by(order, Visit.id.desc()).offset(skip).limit(limit).all()
    return [attach_rollup(v) for v in visits]


def _validate_assigned_member(db: Session, team_id: int | None, assigned_member_id: int | None) -> None:
    if assigned_member_id is None:
        return
    member = db.get(User, assigned_member_id)
    if not member or member.role != UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=404, detail="That account isn't a team-member login")
    if member.team_id != team_id:
        raise HTTPException(status_code=400, detail="That member isn't on this mission's team")


def create_visit_row(payload: VisitCreate, db: Session, user: User) -> Visit:
    """The actual visit-creation logic (auto-generates the 12 fixed positions x 4 image slots) —
    factored out from the route below so routers/teams.py can create a visit that's also a team's
    numbered mission without duplicating this. Does not commit-and-return a response model; caller
    handles that (teams.py sets mission_seq before its own final load)."""
    tower = db.get(Tower, payload.tower_id)
    if not tower:
        raise HTTPException(status_code=404, detail="Tower not found")
    _validate_assigned_member(db, payload.team_id, payload.assigned_member_id)

    visit = Visit(**payload.model_dump(), created_by=user.id)
    db.add(visit)
    db.flush()  # get visit.id

    # Auto-generate the 12 fixed positions (2 OHL x 3 phase x 2 string), each with 4 image slots.
    for ohl in OHL_CHOICES:
        for phase in PHASE_CHOICES:
            for string in STRING_CHOICES:
                pos = Position(visit_id=visit.id, ohl=ohl, phase=phase, string=string)
                db.add(pos)
                db.flush()
                for img_type in IMAGE_TYPE_CHOICES:
                    db.add(Image(position_id=pos.id, image_type=img_type, evidence_status="NOT REQUIRED"))
                db.flush()
                pos.visit = visit
                refresh_position_codes(pos)
    return visit


@router.post("", response_model=VisitDetail, status_code=201)
def create_visit(payload: VisitCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == UserRole.TEAM_MEMBER.value:
        tid = effective_team_id(db, user)
        if not tid:
            raise HTTPException(status_code=403, detail="Your login is not linked to a team yet")
        payload = payload.model_copy(update={"team_id": tid})
    visit = create_visit_row(payload, db, user)
    db.commit()
    return attach_rollup(_load_visit(db, visit.id), detail=True)


@router.get("/{visit_id}", response_model=VisitDetail)
def get_visit(visit_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit = _load_visit(db, visit_id)
    check_visit_team_access(visit, user)
    return attach_rollup(visit, detail=True)


@router.patch("/{visit_id}", response_model=VisitDetail)
def update_visit(
    visit_id: int, payload: VisitUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    visit = _load_visit(db, visit_id)
    check_visit_team_access(visit, user)
    data = payload.model_dump(exclude_unset=True)
    if user.role == UserRole.TEAM_MEMBER.value:
        # A member works their own assigned mission's details/data, but can't reassign it (to
        # themself, someone else, or another team) — that stays a team_leader/admin decision.
        data.pop("team_id", None)
        data.pop("assigned_member_id", None)
    if "assigned_member_id" in data:
        _validate_assigned_member(db, data.get("team_id", visit.team_id), data["assigned_member_id"])
    for k, v in data.items():
        setattr(visit, k, v)
    db.commit()
    return attach_rollup(_load_visit(db, visit_id), detail=True)


def delete_visit_completely(db: Session, visit: Visit) -> None:
    """Removes a visit's positions/images and any directly-uploaded photos — DB rows and files on
    disk alike — then the visit row itself. Shared by delete_visit below and by teams.py's
    delete_team (a team's missions ARE its Visits — deleting the team means deleting these too).
    Caller commits; this only stages the deletes."""
    for pos in visit.positions:
        for img in pos.images:
            for rel_path, base_dir in (
                (img.file_path, settings.images_dir),
                (img.thumbnail_path, settings.thumbnails_dir),
                (img.annotated_path, settings.images_dir),
                (img.annotated_thumbnail_path, settings.thumbnails_dir),
            ):
                if rel_path:
                    fpath = base_dir / rel_path
                    if fpath.exists():
                        fpath.unlink()
    for photo in visit.photos:
        for rel_path, base_dir in ((photo.file_path, settings.images_dir), (photo.thumbnail_path, settings.thumbnails_dir)):
            if rel_path:
                fpath = base_dir / rel_path
                if fpath.exists():
                    fpath.unlink()
    db.delete(visit)


@router.delete("/{visit_id}", status_code=204)
def delete_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently deletes an inspection visit — all its positions/images and any directly-uploaded
    photos (DB rows and files on disk) are removed too. If this visit was also a team's mission,
    that mission is gone with it — the two were never separate records. Cannot be undone, so the
    frontend confirms before calling it. Admin/reviewer can delete any visit; a team_leader only
    one that's their own team's mission."""
    visit = _load_visit(db, visit_id)
    if user.role not in (UserRole.ADMIN.value, UserRole.REVIEWER.value):
        check_visit_team_access(visit, user)
        if user.role != UserRole.TEAM_LEADER.value:
            raise HTTPException(status_code=403, detail="Not enough permissions")
    delete_visit_completely(db, visit)
    db.commit()
    return None


# ---------- Photos: the free-form "drop a photo in, no setup needed" gallery on a visit ----------
def _photo_out(photo: VisitPhoto) -> VisitPhotoOut:
    out = VisitPhotoOut.model_validate(photo)
    out.position_code = photo.position.position_code if photo.position else None
    return out


def _load_visit_photo(db: Session, visit_id: int, photo_id: int, user: User) -> VisitPhoto:
    photo = (
        db.query(VisitPhoto)
        .options(joinedload(VisitPhoto.position))
        .filter(VisitPhoto.id == photo_id, VisitPhoto.visit_id == visit_id)
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    check_visit_team_access(_load_visit(db, visit_id), user)
    return photo


@router.get("/{visit_id}/photos", response_model=list[VisitPhotoOut])
def list_visit_photos(visit_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_visit_team_access(_load_visit(db, visit_id), user)
    photos = (
        db.query(VisitPhoto)
        .options(joinedload(VisitPhoto.position))
        .filter(VisitPhoto.visit_id == visit_id)
        .order_by(VisitPhoto.uploaded_at.desc())
        .all()
    )
    return [_photo_out(p) for p in photos]


@router.post("/{visit_id}/photos", response_model=VisitPhotoOut, status_code=201)
async def upload_visit_photo(
    visit_id: int,
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
    position_id: int | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Any signed-in user can upload — in practice whichever team member is on site with the phone.
    No position/type/direction to pick first, unlike the formal checklist images — just drop it in.
    `position_id`, if given, only tags which insulator this is a photo of (for grouping in the
    gallery and pre-filling the promote dialog) — it doesn't touch the formal checklist by itself."""
    visit = _load_visit(db, visit_id)
    check_visit_team_access(visit, user)
    if file.content_type not in ACCEPTED_IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {file.content_type}")
    if position_id is not None and not any(p.id == position_id for p in visit.positions):
        raise HTTPException(status_code=404, detail="Position not found on this visit")
    raw = await file.read()
    ext = file_extension(file.filename, file.content_type)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    rel_path = f"visit_photos/{slugify_tower_id(visit.tower.tower_id)}/{visit_id}/{stamp}{ext}"
    rel_path, size, _ = save_upload(raw, rel_path)
    thumb_rel = build_thumbnail(rel_path)
    exif = extract_exif_gps_datetime(raw)
    captured_at = None
    if exif.get("capture_date") and exif.get("capture_time"):
        captured_at = dt.datetime.combine(exif["capture_date"], exif["capture_time"])

    photo = VisitPhoto(
        visit_id=visit_id,
        position_id=position_id,
        file_path=rel_path,
        thumbnail_path=thumb_rel,
        content_type=file.content_type,
        original_filename=file.filename,
        file_size=size,
        caption=caption,
        latitude=exif.get("latitude"),
        longitude=exif.get("longitude"),
        captured_at=captured_at,
        uploaded_by=user.id,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return _photo_out(photo)


@router.patch("/{visit_id}/photos/{photo_id}", response_model=VisitPhotoOut)
def update_visit_photo(
    visit_id: int,
    photo_id: int,
    payload: VisitPhotoUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    photo = _load_visit_photo(db, visit_id, photo_id, user)
    data = payload.model_dump(exclude_unset=True)
    if data.get("position_id") is not None:
        visit = _load_visit(db, visit_id)
        if not any(p.id == data["position_id"] for p in visit.positions):
            raise HTTPException(status_code=404, detail="Position not found on this visit")
    for k, v in data.items():
        setattr(photo, k, v)
    db.commit()
    db.refresh(photo)
    return _photo_out(photo)


@router.get("/{visit_id}/photos/{photo_id}/file")
def get_visit_photo_file(
    visit_id: int, photo_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    photo = _load_visit_photo(db, visit_id, photo_id, user)
    path = settings.images_dir / photo.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing from archive")
    return FileResponse(
        path, media_type=photo.content_type or "application/octet-stream", headers={"Cache-Control": "no-cache"}
    )


@router.get("/{visit_id}/photos/{photo_id}/thumbnail")
def get_visit_photo_thumbnail(
    visit_id: int, photo_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    photo = _load_visit_photo(db, visit_id, photo_id, user)
    if not photo.thumbnail_path:
        raise HTTPException(status_code=404, detail="No thumbnail available")
    path = settings.thumbnails_dir / photo.thumbnail_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail missing")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


@router.delete("/{visit_id}/photos/{photo_id}", status_code=204)
def delete_visit_photo(
    visit_id: int, photo_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    photo = _load_visit_photo(db, visit_id, photo_id, user)
    if photo.file_path:
        p = settings.images_dir / photo.file_path
        if p.exists():
            p.unlink()
    if photo.thumbnail_path:
        tp = settings.thumbnails_dir / photo.thumbnail_path
        if tp.exists():
            tp.unlink()
    db.delete(photo)
    db.commit()
    return None


@router.post("/{visit_id}/photos/{photo_id}/promote", response_model=ImageOut)
async def promote_visit_photo(
    visit_id: int,
    photo_id: int,
    payload: VisitPhotoPromote,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Turns a photo from the free-form gallery into the official evidence for one specific
    checklist image slot — e.g. "on closer look this one's better, use it instead of what's in
    that slot now." The caller picks the exact Image row (baseline or a specific extra), not just
    a type — this can overwrite any of a position's slots, not only the baseline. The source photo
    stays in the free-form gallery afterward; it isn't deleted just because it was also used to
    fill a slot, so it's still there to use again elsewhere."""
    visit = _load_visit(db, visit_id)
    check_visit_team_access(visit, user)
    photo = _load_visit_photo(db, visit_id, photo_id, user)

    img = next((i for pos in visit.positions for i in pos.images if i.id == payload.image_id), None)
    if img is None:
        raise HTTPException(status_code=404, detail="Image slot not found on this visit")
    pos = img.position
    if not pos.direction:
        raise HTTPException(status_code=400, detail="Set the position's Direction before assigning images to it")

    src_path = settings.images_dir / photo.file_path
    if not src_path.exists():
        raise HTTPException(status_code=404, detail="The photo's file is missing from storage")
    raw = src_path.read_bytes()
    capture_date = photo.captured_at.date().isoformat() if photo.captured_at else None
    capture_time = photo.captured_at.time().isoformat() if photo.captured_at else None
    await apply_upload(
        img, raw, photo.original_filename, photo.content_type, capture_date, capture_time, photo.latitude, photo.longitude
    )
    db.commit()
    db.refresh(img)
    return img
