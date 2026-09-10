"""Image archiving: storage/images/{year}/{month}/{day}/{TowerID}/{ImageID}.ext

Partitioned by the image's CAPTURE date (not the upload date), so historical
backfills archive to the correct day. Also builds a thumbnail and extracts
EXIF GPS/timestamp when present (best-effort, never blocks the upload).
"""
from __future__ import annotations

import datetime as dt
import hashlib
from pathlib import Path

from PIL import Image as PILImage

from app.config import settings
from app.services.id_gen import slugify_tower_id

THUMBNAIL_SIZE = (480, 480)
ACCEPTED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/tiff", "image/webp", "image/x-tiff"}


def archive_relative_path(tower_id: str, capture_date: dt.date, image_code: str, ext: str) -> str:
    tower_slug = slugify_tower_id(tower_id)
    return "/".join(
        [
            f"{capture_date.year:04d}",
            f"{capture_date.month:02d}",
            f"{capture_date.day:02d}",
            tower_slug,
            f"{image_code}{ext}",
        ]
    )


def save_upload(raw_bytes: bytes, relative_path: str, base_dir: Path | None = None) -> tuple[str, int, str]:
    """Writes the file under `base_dir`/<relative_path> (defaults to storage/images). Returns
    (relative_path, size, sha256)."""
    dest = (base_dir or settings.images_dir) / relative_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw_bytes)
    checksum = hashlib.sha256(raw_bytes).hexdigest()
    return relative_path, len(raw_bytes), checksum


def build_thumbnail(
    source_relative_path: str, source_base_dir: Path | None = None, thumb_base_dir: Path | None = None
) -> str | None:
    """Generates a thumbnail alongside `thumb_base_dir`/<relative_path> (defaults to
    storage/thumbnails), from the original under `source_base_dir` (defaults to storage/images).
    Best-effort."""
    src = (source_base_dir or settings.images_dir) / source_relative_path
    thumb_base_dir = thumb_base_dir or settings.thumbnails_dir
    try:
        with PILImage.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail(THUMBNAIL_SIZE)
            dest = thumb_base_dir / source_relative_path
            dest = dest.with_suffix(".jpg")
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.save(dest, "JPEG", quality=82)
            return str(dest.relative_to(thumb_base_dir)).replace("\\", "/")
    except Exception:
        return None


def tower_photo_relative_path(tower_id: str, ext: str) -> str:
    """A flat, tower-slug-keyed path under storage/tower_photos — unlike inspection images there's
    just one reference photo per tower, so no date/type partitioning is needed."""
    return f"{slugify_tower_id(tower_id)}{ext}"


def extract_exif_gps_datetime(raw_bytes: bytes) -> dict:
    """Best-effort EXIF extraction: returns {latitude, longitude, capture_date, capture_time} or {}."""
    result: dict = {}
    try:
        import piexif

        exif_dict = piexif.load(raw_bytes)
        gps = exif_dict.get("GPS", {})

        def _to_deg(dms, ref):
            deg = dms[0][0] / dms[0][1]
            minute = dms[1][0] / dms[1][1]
            sec = dms[2][0] / dms[2][1]
            value = deg + minute / 60 + sec / 3600
            if ref in (b"S", b"W", "S", "W"):
                value = -value
            return value

        if piexif.GPSIFD.GPSLatitude in gps and piexif.GPSIFD.GPSLatitudeRef in gps:
            result["latitude"] = round(
                _to_deg(gps[piexif.GPSIFD.GPSLatitude], gps[piexif.GPSIFD.GPSLatitudeRef]), 6
            )
        if piexif.GPSIFD.GPSLongitude in gps and piexif.GPSIFD.GPSLongitudeRef in gps:
            result["longitude"] = round(
                _to_deg(gps[piexif.GPSIFD.GPSLongitude], gps[piexif.GPSIFD.GPSLongitudeRef]), 6
            )

        zeroth = exif_dict.get("0th", {})
        exif = exif_dict.get("Exif", {})
        raw_dt = exif.get(piexif.ExifIFD.DateTimeOriginal) or zeroth.get(piexif.ImageIFD.DateTime)
        if raw_dt:
            raw_dt = raw_dt.decode() if isinstance(raw_dt, bytes) else raw_dt
            parsed = dt.datetime.strptime(raw_dt, "%Y:%m:%d %H:%M:%S")
            result["capture_date"] = parsed.date()
            result["capture_time"] = parsed.time()
    except Exception:
        pass
    return result


def file_extension(filename: str | None, content_type: str | None) -> str:
    if filename and "." in filename:
        return "." + filename.rsplit(".", 1)[-1].lower()
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/tiff": ".tiff",
        "image/webp": ".webp",
    }
    return mapping.get(content_type or "", ".bin")
