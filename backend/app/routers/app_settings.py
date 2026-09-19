"""Admin-controlled branding shown on the welcome splash screen — see models.AppSetting and
components/SplashScreen.tsx. A singleton row (id=1), created on first write."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_permission
from app.models import AppSetting, User
from app.schemas import BrandingOut

router = APIRouter(prefix="/api/settings", tags=["settings"])

_IMAGE_FIELDS = {
    "oetc": "oetc_logo_filename",
    "sky-green-line": "sky_green_line_logo_filename",
    "hero": "hero_image_filename",
}


def _get_or_create(db: Session) -> AppSetting:
    row = db.get(AppSetting, 1)
    if not row:
        row = AppSetting(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _image_url(which: str, filename: str | None, updated_at) -> str | None:
    if not filename:
        return None
    return f"/api/settings/branding/image/{which}?v={updated_at.timestamp():.0f}"


def _to_out(row: AppSetting) -> BrandingOut:
    return BrandingOut(
        app_title=row.app_title,
        app_version=row.app_version,
        splash_header=row.splash_header,
        splash_subtitle=row.splash_subtitle,
        oetc_logo_url=_image_url("oetc", row.oetc_logo_filename, row.updated_at),
        sky_green_line_logo_url=_image_url("sky-green-line", row.sky_green_line_logo_filename, row.updated_at),
        oetc_logo_width=row.oetc_logo_width,
        oetc_logo_height=row.oetc_logo_height,
        sky_green_line_logo_width=row.sky_green_line_logo_width,
        sky_green_line_logo_height=row.sky_green_line_logo_height,
        hero_image_url=_image_url("hero", row.hero_image_filename, row.updated_at),
        configured=bool(
            row.app_title or row.splash_header or row.oetc_logo_filename or row.sky_green_line_logo_filename or row.hero_image_filename
        ),
    )


@router.get("/branding", response_model=BrandingOut)
def get_branding(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return _to_out(_get_or_create(db))


@router.put("/branding", response_model=BrandingOut)
def update_branding(
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("manage_settings")),
    app_title: str | None = Form(default=None),
    app_version: str | None = Form(default=None),
    splash_header: str | None = Form(default=None),
    splash_subtitle: str | None = Form(default=None),
    oetc_logo_width: int | None = Form(default=None),
    oetc_logo_height: int | None = Form(default=None),
    sky_green_line_logo_width: int | None = Form(default=None),
    sky_green_line_logo_height: int | None = Form(default=None),
    oetc_logo: UploadFile | None = File(default=None),
    sky_green_line_logo: UploadFile | None = File(default=None),
    hero_image: UploadFile | None = File(default=None),
):
    row = _get_or_create(db)
    row.app_title = app_title or None
    row.app_version = app_version or None
    row.splash_header = splash_header or None
    row.splash_subtitle = splash_subtitle or None
    row.oetc_logo_width = oetc_logo_width
    row.oetc_logo_height = oetc_logo_height
    row.sky_green_line_logo_width = sky_green_line_logo_width
    row.sky_green_line_logo_height = sky_green_line_logo_height
    for upload, field in (
        (oetc_logo, "oetc_logo_filename"),
        (sky_green_line_logo, "sky_green_line_logo_filename"),
        (hero_image, "hero_image_filename"),
    ):
        if upload is None or not upload.filename:
            continue
        if upload.content_type not in ("image/png", "image/jpeg", "image/webp", "image/svg+xml"):
            raise HTTPException(status_code=400, detail=f"{upload.filename}: unsupported image type")
        ext = Path(upload.filename).suffix or ".png"
        stored_name = f"{field}-{uuid.uuid4().hex}{ext}"
        dest = settings.branding_dir / stored_name
        dest.write_bytes(upload.file.read())
        old_name = getattr(row, field)
        setattr(row, field, stored_name)
        if old_name:
            old_path = settings.branding_dir / old_name
            if old_path.exists():
                old_path.unlink()
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.get("/branding/image/{which}")
def get_branding_image(which: str, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    field = _IMAGE_FIELDS.get(which)
    if not field:
        raise HTTPException(status_code=404, detail="Unknown image")
    row = _get_or_create(db)
    filename = getattr(row, field)
    if not filename:
        raise HTTPException(status_code=404, detail="No image uploaded")
    path = settings.branding_dir / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file missing")
    return FileResponse(path)
