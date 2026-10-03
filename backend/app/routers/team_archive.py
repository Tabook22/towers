"""A team's own photo archive — general photos an admin uploads directly (site conditions,
equipment, handover shots, whatever doesn't belong to one specific inspection), distinct from the
per-position evidence images the Image Archive page already shows. Auto-filed by year/month/day
(by upload date in Oman local time) and geo-tagged from EXIF GPS the same
best-effort way as every other photo path in this app.
"""
from __future__ import annotations

import datetime as dt
import io
from uuid import uuid4
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload
from PIL import Image as PillowImage

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_role
from app.models import Team, TeamArchiveImage, User, UserRole
from app.schemas import TeamArchiveImageOut
from app.services.archive import (
    ACCEPTED_IMAGE_CONTENT_TYPES,
    build_thumbnail,
    extract_exif_gps_datetime,
    file_extension,
    save_upload,
    team_archive_relative_path,
)

router = APIRouter(tags=["team-archive"])

OMAN_TIME = dt.timezone(dt.timedelta(hours=4))
IMAGE_CONTENT_TYPE_BY_EXT = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".tif": "image/tiff", ".tiff": "image/tiff", ".webp": "image/webp",
}


def archive_upload_date(value: dt.datetime) -> dt.date:
    """Stored timestamps are UTC; archive calendar folders follow Oman time."""
    return (value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value).astimezone(OMAN_TIME).date()


def upload_content_type(upload: UploadFile) -> str:
    """Use the browser MIME type, falling back to the extension for folder uploads."""
    value = (upload.content_type or "").split(";")[0].strip().lower()
    if value in ACCEPTED_IMAGE_CONTENT_TYPES:
        return value
    return IMAGE_CONTENT_TYPE_BY_EXT.get(Path(upload.filename or "").suffix.lower(), "")


def safe_relative_path(value: str | None, fallback: str | None) -> str:
    """Keep the user's folder/subfolder labels as metadata without allowing traversal."""
    raw = (value or fallback or "").replace("\\", "/")
    parts = [part for part in raw.split("/") if part not in ("", ".", "..")]
    clean = "/".join(parts)
    return clean[:500] or "image"



def _out(row: TeamArchiveImage) -> TeamArchiveImageOut:
    return TeamArchiveImageOut(
        id=row.id,
        team_id=row.team_id,
        team_name=row.team.name if row.team else None,
        capture_date=row.capture_date,
        upload_date=archive_upload_date(row.uploaded_at),
        latitude=row.latitude,
        longitude=row.longitude,
        caption=row.caption,
        content_type=row.content_type,
        original_filename=row.original_filename,
        relative_path=row.relative_path,
        file_size=row.file_size,
        has_thumbnail=bool(row.thumbnail_path),
        uploaded_by=row.uploaded_by,
        uploaded_by_name=(row.uploader.full_name or row.uploader.username) if row.uploader else None,
        uploaded_at=row.uploaded_at,
    )


def _load(db: Session, image_id: int, user: User) -> TeamArchiveImage:
    row = (
        db.query(TeamArchiveImage)
        .options(joinedload(TeamArchiveImage.team), joinedload(TeamArchiveImage.uploader))
        .filter(TeamArchiveImage.id == image_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Image not found")
    if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value) and row.team_id != user.team_id:
        raise HTTPException(status_code=403, detail="Not available for this account")
    return row


@router.post("/api/teams/{team_id}/archive-images", response_model=list[TeamArchiveImageOut])
async def upload_team_archive_images(
    team_id: int,
    files: list[UploadFile] = File(...),
    caption: str | None = Form(default=None),
    relative_paths: list[str] = Form(default=[]),
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one image")

    # Validate actual image bytes and size before storing any part of the batch.
    upload_limit = settings.max_upload_size_mb * 1024 * 1024
    for upload in files:
        content_type = upload_content_type(upload)
        if content_type not in ACCEPTED_IMAGE_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail=f"{upload.filename}: not a supported image type")
        raw = await upload.read(upload_limit + 1)
        if len(raw) > upload_limit:
            raise HTTPException(status_code=413, detail=f"{upload.filename}: image exceeds the upload limit")
        if not raw:
            raise HTTPException(status_code=400, detail=f"{upload.filename}: image is empty")
        try:
            with PillowImage.open(io.BytesIO(raw)) as image:
                image.verify()
        except Exception:
            raise HTTPException(status_code=422, detail=f"{upload.filename}: this file could not be read as an image")
        await upload.seek(0)

    uploaded_at = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    upload_date = archive_upload_date(uploaded_at)
    stored_paths: list[tuple[Path, str]] = []
    created: list[TeamArchiveImage] = []
    try:
        for index, upload in enumerate(files):
            content_type = upload_content_type(upload)
            if content_type not in ACCEPTED_IMAGE_CONTENT_TYPES:
                raise HTTPException(status_code=400, detail=f"{upload.filename}: not a supported image type")
            raw = await upload.read(upload_limit + 1)
            if not raw:
                continue
            exif = extract_exif_gps_datetime(raw)
            capture_date = exif.get("capture_date") or upload_date
            ext = file_extension(upload.filename, content_type)
            code = f"img-{uuid4().hex[:12]}"
            rel_path = team_archive_relative_path(team_id, upload_date, code, ext)
            rel_path, size, _checksum = save_upload(raw, rel_path)
            stored_paths.append((settings.images_dir, rel_path))
            thumb_path = build_thumbnail(rel_path)
            if thumb_path:
                stored_paths.append((settings.thumbnails_dir, thumb_path))

            row = TeamArchiveImage(
                team_id=team_id,
                capture_date=capture_date,
                latitude=exif.get("latitude"),
                longitude=exif.get("longitude"),
                caption=(caption or "").strip() or None,
                file_path=rel_path,
                thumbnail_path=thumb_path,
                content_type=content_type,
                original_filename=Path(safe_relative_path(relative_paths[index] if index < len(relative_paths) else None, upload.filename)).name,
                relative_path=safe_relative_path(relative_paths[index] if index < len(relative_paths) else None, upload.filename),
                file_size=size,
                uploaded_by=user.id,
                uploaded_at=uploaded_at,
            )
            db.add(row)
            created.append(row)

        if not created:
            raise HTTPException(status_code=400, detail="No files were uploaded")
        db.commit()
    except Exception:
        db.rollback()
        for base, relative in stored_paths:
            try:
                (base / relative).unlink(missing_ok=True)
            except OSError:
                pass
        raise
    for row in created:
        db.refresh(row)
        row.team = team
        row.uploader = user
    return [_out(row) for row in created]


@router.get("/api/archive/team-images", response_model=list[TeamArchiveImageOut])
def list_team_archive_images(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    team_id: int | None = None,
    year: int | None = None,
    month: int | None = None,
    day: int | None = None,
    skip: int = 0,
    limit: int = 200,
):
    if skip < 0 or not 1 <= limit <= 500:
        raise HTTPException(status_code=422, detail="Invalid archive page")
    if (year is not None and not 1 <= year <= 9999) or (month is not None and not 1 <= month <= 12) or (day is not None and not 1 <= day <= 31):
        raise HTTPException(status_code=422, detail="Invalid upload date filter")
    q = db.query(TeamArchiveImage).options(joinedload(TeamArchiveImage.team), joinedload(TeamArchiveImage.uploader))
    if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value):
        q = q.filter(TeamArchiveImage.team_id == user.team_id) if user.team_id else q.filter(False)
    elif team_id:
        q = q.filter(TeamArchiveImage.team_id == team_id)
    rows = q.order_by(TeamArchiveImage.uploaded_at.desc(), TeamArchiveImage.id.desc()).all()

    def matches(row: TeamArchiveImage) -> bool:
        filed = archive_upload_date(row.uploaded_at)
        if year and filed.year != year:
            return False
        if month and filed.month != month:
            return False
        if day and filed.day != day:
            return False
        return True

    filtered = [r for r in rows if matches(r)]
    return [_out(r) for r in filtered[skip : skip + limit]]


@router.get("/api/archive/team-images/{image_id}/file")
def get_team_archive_image_file(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _load(db, image_id, user)
    path = settings.images_dir / row.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing from archive")
    return FileResponse(path, media_type=row.content_type or "application/octet-stream", headers={"Cache-Control": "no-cache"})


@router.get("/api/archive/team-images/{image_id}/thumbnail")
def get_team_archive_image_thumbnail(image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _load(db, image_id, user)
    if not row.thumbnail_path:
        raise HTTPException(status_code=404, detail="No thumbnail available")
    path = settings.thumbnails_dir / row.thumbnail_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail missing")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


@router.delete("/api/archive/team-images/{image_id}", status_code=204)
def delete_team_archive_image(
    image_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    row = db.get(TeamArchiveImage, image_id)
    if not row:
        raise HTTPException(status_code=404, detail="Image not found")
    for rel, base in ((row.file_path, settings.images_dir), (row.thumbnail_path, settings.thumbnails_dir)):
        if not rel:
            continue
        try:
            (base / rel).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(row)
    db.commit()
    return None
