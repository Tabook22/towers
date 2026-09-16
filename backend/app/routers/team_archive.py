"""A team's own photo archive — general photos an admin uploads directly (site conditions,
equipment, handover shots, whatever doesn't belong to one specific inspection), distinct from the
per-position evidence images the Image Archive page already shows. Auto-filed by year/month/day
(from EXIF capture date when present, else the upload date) and geo-tagged from EXIF GPS the same
best-effort way as every other photo path in this app.
"""
from __future__ import annotations

import datetime as dt
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

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


def _out(row: TeamArchiveImage) -> TeamArchiveImageOut:
    return TeamArchiveImageOut(
        id=row.id,
        team_id=row.team_id,
        team_name=row.team.name if row.team else None,
        capture_date=row.capture_date,
        latitude=row.latitude,
        longitude=row.longitude,
        caption=row.caption,
        content_type=row.content_type,
        original_filename=row.original_filename,
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
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one image")

    created: list[TeamArchiveImage] = []
    for upload in files:
        content_type = (upload.content_type or "").split(";")[0].strip().lower()
        if content_type not in ACCEPTED_IMAGE_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail=f"{upload.filename}: not a supported image type")
        raw = await upload.read()
        if not raw:
            continue
        exif = extract_exif_gps_datetime(raw)
        capture_date = exif.get("capture_date") or dt.date.today()
        ext = file_extension(upload.filename, upload.content_type)
        code = f"img-{uuid4().hex[:12]}"
        rel_path = team_archive_relative_path(team_id, capture_date, code, ext)
        rel_path, size, _checksum = save_upload(raw, rel_path)
        thumb_path = build_thumbnail(rel_path)

        row = TeamArchiveImage(
            team_id=team_id,
            capture_date=capture_date,
            latitude=exif.get("latitude"),
            longitude=exif.get("longitude"),
            caption=(caption or "").strip() or None,
            file_path=rel_path,
            thumbnail_path=thumb_path,
            content_type=upload.content_type,
            original_filename=upload.filename,
            file_size=size,
            uploaded_by=user.id,
        )
        db.add(row)
        created.append(row)

    if not created:
        raise HTTPException(status_code=400, detail="No files were uploaded")
    db.commit()
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
    q = db.query(TeamArchiveImage).options(joinedload(TeamArchiveImage.team), joinedload(TeamArchiveImage.uploader))
    if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value):
        q = q.filter(TeamArchiveImage.team_id == user.team_id) if user.team_id else q.filter(False)
    elif team_id:
        q = q.filter(TeamArchiveImage.team_id == team_id)
    rows = q.order_by(TeamArchiveImage.capture_date.desc(), TeamArchiveImage.id.desc()).all()

    def matches(row: TeamArchiveImage) -> bool:
        if year and row.capture_date.year != year:
            return False
        if month and row.capture_date.month != month:
            return False
        if day and row.capture_date.day != day:
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
