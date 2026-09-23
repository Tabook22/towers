from __future__ import annotations

import base64
import datetime as dt
import io
import uuid
from pathlib import Path

import cv2
import numpy as np
from PIL import Image as PILImage, UnidentifiedImageError
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import check_visit_team_access, get_current_user
from app.models import Image, Position, ReportImage, User, UserRole, Visit
from app.schemas import ImageOut, ImageRetype, ImageUpdate, PositionOut, SmartEnhanceOut
from app.services.archive import (
    ACCEPTED_IMAGE_CONTENT_TYPES,
    archive_relative_path,
    build_thumbnail,
    extract_exif_gps_datetime,
    file_extension,
    save_upload,
)
from app.services.id_gen import image_code as compute_image_code
from app.services.smart_enhance import smart_enhance

router = APIRouter(prefix="/api/images", tags=["images"])

ACCEPTED_CONTENT_TYPES = ACCEPTED_IMAGE_CONTENT_TYPES


def _load_image(db: Session, image_id: int, user: User) -> Image:
    img = (
        db.query(Image)
        .options(joinedload(Image.position).joinedload(Position.visit).joinedload(Visit.tower))
        .filter(Image.id == image_id)
        .first()
    )
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    check_visit_team_access(img.position.visit, user)
    return img


@router.get("/{image_id}", response_model=ImageOut)
def get_image(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _load_image(db, image_id, user)


@router.patch("/{image_id}", response_model=ImageOut)
def update_image(
    image_id: int, payload: ImageUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    img = _load_image(db, image_id, user)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(img, k, v)
    db.commit()
    db.refresh(img)
    return img


def _with_jpg_suffix(rel: str) -> str:
    """Swaps a relative archive path's extension for .jpg, the way build_thumbnail does — as a plain
    string operation, not via pathlib. `rel` always uses forward slashes (archive_relative_path's
    convention, matched everywhere else a path gets stored), and a pathlib round-trip on Windows
    would silently re-serialize it with backslashes instead."""
    base, dot, _ext = rel.rpartition(".")
    return f"{base}.jpg" if dot else f"{rel}.jpg"


def _move_archived_file(base_dir: Path, old_rel: str | None, new_rel: str) -> str | None:
    """Renames an archived file onto a new relative path (used by retype below, where the image_code
    — and so the archive path derived from it — changes). Best-effort: a missing source (e.g. a
    thumbnail that failed to generate) just means nothing to move."""
    if not old_rel:
        return None
    old_path = base_dir / old_rel
    if not old_path.exists():
        return None
    new_path = base_dir / new_rel
    if old_path == new_path:
        return old_rel
    new_path.parent.mkdir(parents=True, exist_ok=True)
    old_path.replace(new_path)
    return new_rel


@router.post("/{image_id}/retype", response_model=ImageOut)
def retype_image(
    image_id: int, payload: ImageRetype, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Re-tags an uploaded photo as a different image_type — e.g. something uploaded as "TH Full"
    that should actually have been "RGB Close". The file (and its annotation, if any) moves onto a
    fresh image_code for the new type: straight onto that type's empty baseline slot if there is one,
    otherwise as a new supplementary row. If the source was itself a baseline slot, it's reset to
    empty afterwards rather than removed — the fixed one-slot-per-type checklist still needs
    *something* there for `visit_rollup` to count against (see models.Image's docstring)."""
    img = _load_image(db, image_id, user)
    if not img.file_path:
        raise HTTPException(status_code=400, detail="Nothing to retype — this slot has no image yet")
    if payload.new_type == img.image_type:
        raise HTTPException(status_code=400, detail="Already this type")

    pos = (
        db.query(Position)
        .options(joinedload(Position.images), joinedload(Position.visit).joinedload(Visit.tower))
        .filter(Position.id == img.position_id)
        .first()
    )
    tower = pos.visit.tower

    dest = next(
        (i for i in pos.images if i.image_type == payload.new_type and i.sequence == 1 and not i.file_path), None
    )
    if dest is None:
        existing = [i for i in pos.images if i.image_type == payload.new_type]
        next_seq = max((i.sequence for i in existing), default=0) + 1
        base_code = compute_image_code(pos.position_code, pos.ohl, pos.phase, pos.string, pos.direction, payload.new_type)
        new_code = base_code if next_seq == 1 else f"{base_code}-{next_seq}"
        dest = Image(position_id=pos.id, image_type=payload.new_type, image_code=new_code, sequence=next_seq)
        db.add(dest)
        db.flush()

    cap_date = img.capture_date or dt.date.today()
    ext = Path(img.file_path).suffix
    new_rel = archive_relative_path(tower.tower_id, cap_date, dest.image_code, ext)
    moved_file = _move_archived_file(settings.images_dir, img.file_path, new_rel)
    moved_thumb = _move_archived_file(settings.thumbnails_dir, img.thumbnail_path, _with_jpg_suffix(new_rel))

    moved_annotated = None
    moved_annotated_thumb = None
    if img.annotated_path:
        new_ann_rel = archive_relative_path(tower.tower_id, cap_date, f"{dest.image_code}-annotated", Path(img.annotated_path).suffix)
        moved_annotated = _move_archived_file(settings.images_dir, img.annotated_path, new_ann_rel)
        moved_annotated_thumb = _move_archived_file(
            settings.thumbnails_dir, img.annotated_thumbnail_path, _with_jpg_suffix(new_ann_rel)
        )

    dest.file_path = moved_file
    dest.thumbnail_path = moved_thumb
    dest.original_filename = img.original_filename
    dest.content_type = img.content_type
    dest.file_size = img.file_size
    dest.checksum = img.checksum
    dest.uploaded_at = img.uploaded_at
    dest.capture_date = img.capture_date
    dest.capture_time = img.capture_time
    dest.latitude = img.latitude
    dest.longitude = img.longitude
    dest.evidence_status = "COMPLETE"
    dest.annotated_path = moved_annotated
    dest.annotated_thumbnail_path = moved_annotated_thumb
    dest.annotated_uploaded_at = img.annotated_uploaded_at if moved_annotated else None

    if img.sequence == 1:
        img.file_path = None
        img.thumbnail_path = None
        img.original_filename = None
        img.content_type = None
        img.file_size = None
        img.checksum = None
        img.uploaded_at = None
        img.capture_date = None
        img.capture_time = None
        img.latitude = None
        img.longitude = None
        img.evidence_status = "PENDING CAPTURE"
        img.annotated_path = None
        img.annotated_thumbnail_path = None
        img.annotated_uploaded_at = None
    else:
        db.delete(img)

    db.commit()
    db.refresh(dest)
    return dest


async def apply_upload(
    img: Image,
    raw: bytes,
    filename: str | None,
    content_type: str | None,
    capture_date: str | None,
    capture_time: str | None,
    latitude: float | None,
    longitude: float | None,
    *,
    new_revision: bool = False,
) -> None:
    """Validates and archives `raw` onto an already-created (and already `image_code`d) Image row —
    shared by the original upload endpoint and by positions.create_extra_image, which creates a new
    row for a supplementary gallery shot before calling this the same way."""
    tower = img.position.visit.tower
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB limit")
    if content_type not in ACCEPTED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {content_type}")

    exif = extract_exif_gps_datetime(raw)

    # Priority: explicit form field > EXIF > existing value > today's date
    cap_date = (
        dt.date.fromisoformat(capture_date)
        if capture_date
        else exif.get("capture_date") or img.capture_date or dt.date.today()
    )
    cap_time = dt.time.fromisoformat(capture_time) if capture_time else exif.get("capture_time") or img.capture_time
    lat = latitude if latitude is not None else exif.get("latitude") or img.latitude
    lon = longitude if longitude is not None else exif.get("longitude") or img.longitude

    if not img.image_code:
        raise HTTPException(status_code=400, detail="Image code could not be generated — check position fields")

    ext = file_extension(filename, content_type)
    storage_code = f"{img.image_code}-revision-{uuid.uuid4().hex}" if new_revision else img.image_code
    rel_path = archive_relative_path(tower.tower_id, cap_date, storage_code, ext)
    rel_path, size, checksum = save_upload(raw, rel_path)
    thumb_path = build_thumbnail(rel_path)

    img.capture_date = cap_date
    img.capture_time = cap_time
    img.latitude = lat
    img.longitude = lon
    img.file_path = rel_path
    img.thumbnail_path = thumb_path
    img.original_filename = filename
    img.content_type = content_type
    img.file_size = size
    img.checksum = checksum
    img.uploaded_at = dt.datetime.now(dt.timezone.utc)
    img.evidence_status = "COMPLETE"


@router.post("/{image_id}/upload", response_model=ImageOut)
async def upload_image(
    image_id: int,
    file: UploadFile = File(...),
    capture_date: str | None = Form(default=None),
    capture_time: str | None = Form(default=None),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    img = _load_image(db, image_id, user)
    if not img.position.direction:
        raise HTTPException(status_code=400, detail="Set the position's Direction before uploading images")

    raw = await file.read()
    await apply_upload(img, raw, file.filename, file.content_type, capture_date, capture_time, latitude, longitude)

    db.commit()
    db.refresh(img)
    return img


@router.post("/{image_id}/replace", response_model=ImageOut)
async def replace_image(
    image_id: int,
    file: UploadFile = File(...),
    expected_checksum: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Replace the current evidence in-place logically, retaining the previous files on disk.

    A fresh storage path means invalid files or a failed database commit cannot overwrite the
    current original. Existing report documents are independent, already-rendered files.
    """
    if user.role not in (UserRole.ADMIN.value, UserRole.REVIEWER.value, UserRole.TEAM_LEADER.value):
        raise HTTPException(status_code=403, detail="You cannot replace inspection evidence")
    img = _load_image(db, image_id, user)
    if not img.file_path:
        raise HTTPException(status_code=400, detail="This image slot is empty. Upload evidence from the inspection first.")
    if expected_checksum and expected_checksum != img.checksum:
        raise HTTPException(status_code=409, detail="This image changed since you opened it. Refresh the archive before replacing it.")
    raw = await file.read(settings.max_upload_size_mb * 1024 * 1024 + 1)
    if len(raw) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB limit")
    try:
        with PILImage.open(io.BytesIO(raw)) as candidate:
            if candidate.format not in ("JPEG", "PNG", "TIFF", "WEBP"):
                raise ValueError("Unsupported image format")
            candidate.verify()
        with PILImage.open(io.BytesIO(raw)) as candidate:
            candidate.load()
    except (UnidentifiedImageError, OSError, ValueError, PILImage.DecompressionBombError):
        raise HTTPException(status_code=400, detail="Choose a valid JPEG, PNG, TIFF or WebP image. The current image has not been replaced.")
    await apply_upload(img, raw, file.filename, file.content_type, None, None, None, None, new_revision=True)
    # Markup belongs to the old pixels. Keep its files for recovery, but never render it on the
    # replacement or in a newly generated report.
    img.annotated_path = None
    img.annotated_thumbnail_path = None
    img.annotated_uploaded_at = None
    db.commit()
    db.refresh(img)
    return img


def _snapshot_upload_meta(img: Image) -> dict:
    return {
        "filename": img.original_filename,
        "content_type": img.content_type,
        "capture_date": img.capture_date.isoformat() if img.capture_date else None,
        "capture_time": img.capture_time.isoformat() if img.capture_time else None,
        "latitude": img.latitude,
        "longitude": img.longitude,
    }


def _clear_annotation_files(img: Image) -> None:
    """An annotation is markup drawn on one specific photo — it doesn't make sense to carry it over
    onto whatever content ends up in that row after a swap, so it's dropped (files included)."""
    if img.annotated_path:
        p = settings.images_dir / img.annotated_path
        if p.exists():
            p.unlink()
    if img.annotated_thumbnail_path:
        tp = settings.thumbnails_dir / img.annotated_thumbnail_path
        if tp.exists():
            tp.unlink()
    img.annotated_path = None
    img.annotated_thumbnail_path = None
    img.annotated_uploaded_at = None


@router.post("/{image_id}/make-primary", response_model=PositionOut)
async def make_primary(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Makes this EXTRA image (sequence > 1) the one that counts as official evidence for its
    position+type — e.g. extra #3 turns out to be the better shot, so it swaps places with whatever
    is currently the primary (sequence 1) image. Nothing is lost: the old primary becomes this row's
    content instead, so it's still there as an extra. Each side is re-archived through the normal
    upload path (apply_upload) onto its own row's already-assigned file path, so this is really just
    "upload the other one's bytes here and vice versa" — no renaming, no orphaned files. Annotations
    don't follow the swap (they were drawn on specific pixels, not the slot) and are cleared."""
    extra = _load_image(db, image_id, user)
    if extra.sequence == 1:
        raise HTTPException(status_code=400, detail="This is already the primary image for its slot")
    if not extra.file_path:
        raise HTTPException(status_code=400, detail="This slot has no image to make primary")
    extra_path = settings.images_dir / extra.file_path
    if not extra_path.exists():
        raise HTTPException(status_code=404, detail="This image's file is missing from storage")

    pos = extra.position
    baseline = next((i for i in pos.images if i.image_type == extra.image_type and i.sequence == 1), None)
    if baseline is None:
        raise HTTPException(status_code=404, detail="This position's baseline slot for that type is missing")

    extra_raw = extra_path.read_bytes()
    extra_meta = _snapshot_upload_meta(extra)

    baseline_raw = None
    baseline_meta = None
    if baseline.file_path:
        baseline_path = settings.images_dir / baseline.file_path
        if baseline_path.exists():
            baseline_raw = baseline_path.read_bytes()
            baseline_meta = _snapshot_upload_meta(baseline)

    _clear_annotation_files(extra)
    _clear_annotation_files(baseline)

    # The extra's content becomes the new primary...
    await apply_upload(
        baseline, extra_raw, extra_meta["filename"], extra_meta["content_type"],
        extra_meta["capture_date"], extra_meta["capture_time"], extra_meta["latitude"], extra_meta["longitude"],
    )
    # ...and whatever the primary used to be moves into this extra slot instead of being lost. If
    # the primary slot was empty to begin with, this extra slot is simply cleared out.
    if baseline_raw is not None:
        await apply_upload(
            extra, baseline_raw, baseline_meta["filename"], baseline_meta["content_type"],
            baseline_meta["capture_date"], baseline_meta["capture_time"], baseline_meta["latitude"], baseline_meta["longitude"],
        )
    else:
        extra.file_path = None
        extra.thumbnail_path = None
        extra.original_filename = None
        extra.content_type = None
        extra.file_size = None
        extra.checksum = None
        extra.uploaded_at = None
        extra.evidence_status = "PENDING CAPTURE"

    db.commit()
    db.refresh(pos)
    return pos


@router.delete("/{image_id}", status_code=204, responses={400: {"description": "Cannot delete a baseline slot"}})
def delete_image(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Fully removes an image row — only ever allowed for sequence > 1 (extra gallery shots added
    beyond the original one-per-type baseline). The baseline 48 slots per visit are never deleted,
    only cleared (see clear_image_file) — that's what the fixed Image ID scheme (§4) assumes. A
    client account additionally needs User.can_delete_report_images, and only for an image that's
    actually part of a report they can see (see models.ReportImage) — never a blanket delete right
    over every image in the system."""
    img = _load_image(db, image_id, user)
    if user.role == UserRole.CLIENT.value:
        if not user.can_delete_report_images:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        if not db.query(ReportImage).filter(ReportImage.image_id == image_id).first():
            raise HTTPException(status_code=403, detail="Not enough permissions")
    if img.sequence == 1:
        raise HTTPException(
            status_code=400,
            detail="This is a baseline evidence slot and can't be deleted — use Replace or Remove file instead.",
        )
    if img.file_path:
        path = settings.images_dir / img.file_path
        if path.exists():
            path.unlink()
    if img.thumbnail_path:
        tpath = settings.thumbnails_dir / img.thumbnail_path
        if tpath.exists():
            tpath.unlink()
    if img.annotated_path:
        apath = settings.images_dir / img.annotated_path
        if apath.exists():
            apath.unlink()
    if img.annotated_thumbnail_path:
        atpath = settings.thumbnails_dir / img.annotated_thumbnail_path
        if atpath.exists():
            atpath.unlink()
    db.delete(img)
    db.commit()
    return None


@router.delete("/{image_id}/file", response_model=ImageOut)
def clear_image_file(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Removes the uploaded file (DB record + evidence status only — keeps the slot)."""
    img = _load_image(db, image_id, user)
    if img.file_path:
        path = settings.images_dir / img.file_path
        if path.exists():
            path.unlink()
    if img.thumbnail_path:
        tpath = settings.thumbnails_dir / img.thumbnail_path
        if tpath.exists():
            tpath.unlink()
    img.file_path = None
    img.thumbnail_path = None
    img.original_filename = None
    img.file_size = None
    img.checksum = None
    img.uploaded_at = None
    img.evidence_status = "PENDING CAPTURE"
    db.commit()
    db.refresh(img)
    return img


@router.get("/{image_id}/file")
def get_image_file(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    img = _load_image(db, image_id, user)
    if not img.file_path:
        raise HTTPException(status_code=404, detail="No file uploaded for this image slot")
    path = settings.images_dir / img.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing from archive")
    # The frontend cache-busts via a `?v=<uploaded_at>` query param — a Replace-image bumps
    # uploaded_at, which is a brand new URL the browser has never seen, so it can never serve a
    # stale copy from cache. That already fully covers the "won't show an old photo" concern, which
    # means this exact URL's bytes can never change — safe (and, for a ~1 MB original photo the
    # annotator re-fetches on every open, worth a lot) to cache hard rather than revalidate-on-use.
    return FileResponse(
        path,
        media_type=img.content_type or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/{image_id}/thumbnail")
def get_image_thumbnail(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    img = _load_image(db, image_id, user)
    if not img.thumbnail_path:
        raise HTTPException(status_code=404, detail="No thumbnail available")
    path = settings.thumbnails_dir / img.thumbnail_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail missing")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.post("/{image_id}/annotation", response_model=ImageOut)
async def save_annotation(
    image_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Saves a marked-up copy (circles/lines/rectangles the inspector drew to point at a fault) as
    its own file — the original evidence photo (file_path) is never touched."""
    img = _load_image(db, image_id, user)
    if not img.file_path or not img.image_code:
        raise HTTPException(status_code=400, detail="Upload the original image before adding an annotation")

    raw = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB limit")
    if file.content_type not in ACCEPTED_IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    tower = img.position.visit.tower
    cap_date = img.capture_date or dt.date.today()
    ext = file_extension(file.filename, file.content_type)
    rel_path = archive_relative_path(tower.tower_id, cap_date, f"{img.image_code}-annotated", ext)
    rel_path, _size, _checksum = save_upload(raw, rel_path)
    thumb_path = build_thumbnail(rel_path)

    img.annotated_path = rel_path
    img.annotated_thumbnail_path = thumb_path
    img.annotated_uploaded_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    db.refresh(img)
    return img


@router.delete("/{image_id}/annotation", response_model=ImageOut)
def clear_annotation(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    img = _load_image(db, image_id, user)
    if img.annotated_path:
        path = settings.images_dir / img.annotated_path
        if path.exists():
            path.unlink()
    if img.annotated_thumbnail_path:
        tpath = settings.thumbnails_dir / img.annotated_thumbnail_path
        if tpath.exists():
            tpath.unlink()
    img.annotated_path = None
    img.annotated_thumbnail_path = None
    img.annotated_uploaded_at = None
    db.commit()
    db.refresh(img)
    return img


@router.get("/{image_id}/annotation")
def get_annotation_file(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    img = _load_image(db, image_id, user)
    if not img.annotated_path:
        raise HTTPException(status_code=404, detail="No annotation saved for this image")
    path = settings.images_dir / img.annotated_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Annotated file missing from archive")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/{image_id}/annotation/thumbnail")
def get_annotation_thumbnail(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    img = _load_image(db, image_id, user)
    if not img.annotated_thumbnail_path:
        raise HTTPException(status_code=404, detail="No annotation saved for this image")
    path = settings.thumbnails_dir / img.annotated_thumbnail_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Annotated thumbnail missing from archive")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.post("/{image_id}/smart-enhance", response_model=SmartEnhanceOut)
async def smart_enhance_image(
    image_id: int,
    file: UploadFile = File(...),
    roi_x: int = Form(...),
    roi_y: int = Form(...),
    roi_w: int = Form(...),
    roi_h: int = Form(...),
    strength: str = Form(default="balanced"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """"Auto enhance selected insulator" — the caller draws a box around the insulator string in
    the annotator and posts the ORIGINAL (unadjusted) photo plus that box; nothing is saved here,
    the result is a preview the annotator layers under its own live brightness/contrast/saturation
    and any drawn marks (see ImageAnnotator.tsx's recomputeHeavy). image_id is only used to check
    the caller can actually see this image — the photo itself always comes from `file`, the same
    "upload what's currently on the canvas" pattern save_annotation already uses."""
    _load_image(db, image_id, user)  # access check only — the bytes to process are in `file`
    if strength not in ("gentle", "balanced", "strong"):
        raise HTTPException(status_code=400, detail="strength must be 'gentle', 'balanced', or 'strong'")
    if file.content_type not in ACCEPTED_IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")
    raw = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB limit")

    image_bgr = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise HTTPException(status_code=400, detail="Could not read this image")

    result_bgr, direction_deg, pitch_px, confidence = smart_enhance(image_bgr, (roi_x, roi_y, roi_w, roi_h), strength)
    ok, encoded = cv2.imencode(".jpg", result_bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise HTTPException(status_code=500, detail="Could not encode the enhanced image")

    return SmartEnhanceOut(
        image_base64=base64.b64encode(encoded.tobytes()).decode("ascii"),
        direction_deg=direction_deg,
        pitch_px=pitch_px,
        confidence=confidence,
    )
