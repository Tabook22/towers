from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_role
from app.models import Area, Team, Tower, User, UserRole, Visit
from app.schemas import TowerBulkAssignRequest, TowerCreate, TowerImportResult, TowerOut, TowerUpdate, TowerWithStats
from app.services.archive import (
    ACCEPTED_IMAGE_CONTENT_TYPES,
    build_thumbnail,
    file_extension,
    save_upload,
    tower_photo_relative_path,
)
from app.services.rollup import visit_rollup
from app.services.tower_import import build_tower_import_template, import_towers_from_excel

router = APIRouter(prefix="/api/towers", tags=["towers"])


@router.get("", response_model=list[TowerWithStats])
def list_towers(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    search: str | None = Query(default=None, description="Search by Tower ID or area"),
    area: str | None = None,
    assigned_team_id: int | None = Query(default=None, description="Filter to towers assigned to this team"),
    unassigned: bool = Query(default=False, description="Filter to towers with no team assigned yet"),
    include_inactive: bool = False,
    skip: int = 0,
    limit: int = 200,
):
    """Paginated, searchable tower list — designed for hundreds/thousands of towers."""
    q = db.query(Tower).options(joinedload(Tower.assigned_team))
    if not include_inactive:
        q = q.filter(Tower.is_active.is_(True))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(Tower.tower_id.ilike(like), Tower.area.ilike(like)))
    if area:
        q = q.filter(Tower.area == area)
    if unassigned:
        q = q.filter(Tower.assigned_team_id.is_(None))
    elif assigned_team_id is not None:
        q = q.filter(Tower.assigned_team_id == assigned_team_id)
    towers = q.order_by(Tower.tower_id).offset(skip).limit(limit).all()

    rows = []
    for t in towers:
        latest_visit = (
            db.query(Visit).filter(Visit.tower_id == t.id).order_by(Visit.inspection_date.desc(), Visit.id.desc()).first()
        )
        stats = TowerWithStats.model_validate(t)
        stats.assigned_team_name = t.assigned_team.name if t.assigned_team else None
        stats.visit_count = db.query(Visit).filter(Visit.tower_id == t.id).count()
        if latest_visit:
            rollup = visit_rollup(latest_visit)
            stats.latest_visit_status = rollup["visit_status"]
            stats.latest_visit_date = latest_visit.inspection_date
            stats.open_hotspots = rollup["hotspots"]
        rows.append(stats)
    return rows


@router.get("/areas", response_model=list[str])
def list_areas(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    """Names for the Area filter/dropdown everywhere else in the app — from the admin-managed Area
    catalog (see routers/areas.py) now, not just whatever's currently on a tower, so a newly-added
    area shows up here immediately even before any tower uses it."""
    return [a.name for a in db.query(Area).order_by(Area.name).all()]


def _tower_out(tower: Tower) -> TowerOut:
    out = TowerOut.model_validate(tower)
    out.assigned_team_name = tower.assigned_team.name if tower.assigned_team else None
    return out


@router.post("", response_model=TowerOut, status_code=201)
def create_tower(payload: TowerCreate, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    exists = db.query(Tower).filter(Tower.tower_id.ilike(payload.tower_id)).first()
    if exists:
        raise HTTPException(status_code=400, detail=f"Tower ID '{payload.tower_id}' already exists")
    tower = Tower(**payload.model_dump())
    db.add(tower)
    db.commit()
    db.refresh(tower)
    return _tower_out(tower)


@router.post("/bulk-assign", response_model=list[TowerOut])
def bulk_assign_towers(
    payload: TowerBulkAssignRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """The core of "admin assigns towers to a team" — sets (or clears, if team_id is None)
    Tower.assigned_team_id on every tower id given, in one action. This is what
    routers/teams.py's team_job_map and progress tracking are actually built on; a team's whole
    "job" is just whichever towers point at it here."""
    if payload.team_id is not None:
        team = db.get(Team, payload.team_id)
        if not team:
            raise HTTPException(status_code=404, detail="Team not found")
    towers = db.query(Tower).filter(Tower.id.in_(payload.tower_ids)).all()
    found_ids = {t.id for t in towers}
    missing = set(payload.tower_ids) - found_ids
    if missing:
        raise HTTPException(status_code=404, detail=f"Tower id(s) not found: {sorted(missing)}")
    for t in towers:
        t.assigned_team_id = payload.team_id
    db.commit()
    for t in towers:
        db.refresh(t)
    return [_tower_out(t) for t in towers]


@router.get("/import/template")
def download_tower_import_template(
    _admin: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """A starter .xlsx — the exact columns the importer below understands, plus a worked example
    row and a "Read me" sheet explaining the upsert-by-Tower-ID rule."""
    xlsx_bytes = build_tower_import_template()
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="tower-import-template.xlsx"'},
    )


@router.post("/import", response_model=TowerImportResult)
async def import_towers(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """Bulk create/update towers from an uploaded Excel file — one row per tower, upserted by
    Tower ID (existing ID -> fields updated in place; new ID -> tower created). See
    services/tower_import.py for the exact column rules; download_tower_import_template above
    gives the admin a working starter file with those same columns."""
    raw = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB limit")
    result = import_towers_from_excel(db, raw)
    return result


@router.get("/{tower_pk}", response_model=TowerOut)
def get_tower(tower_pk: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    tower = db.get(Tower, tower_pk)
    if not tower:
        raise HTTPException(status_code=404, detail="Tower not found")
    return _tower_out(tower)


@router.patch("/{tower_pk}", response_model=TowerOut)
def update_tower(
    tower_pk: int, payload: TowerUpdate, db: Session = Depends(get_db), _user: User = Depends(get_current_user)
):
    tower = db.get(Tower, tower_pk)
    if not tower:
        raise HTTPException(status_code=404, detail="Tower not found")
    data = payload.model_dump(exclude_unset=True)
    if "tower_id" in data and data["tower_id"]:
        new_id = data["tower_id"].strip()
        clash = db.query(Tower).filter(Tower.tower_id.ilike(new_id), Tower.id != tower_pk).first()
        if clash:
            raise HTTPException(status_code=400, detail=f"Tower ID '{new_id}' already exists")
        data["tower_id"] = new_id
    if "assigned_team_id" in data and data["assigned_team_id"] is not None:
        if not db.get(Team, data["assigned_team_id"]):
            raise HTTPException(status_code=404, detail="Team not found")
    for k, v in data.items():
        setattr(tower, k, v)
    db.commit()
    db.refresh(tower)
    return _tower_out(tower)


@router.delete("/{tower_pk}", status_code=204)
def deactivate_tower(
    tower_pk: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    tower = db.get(Tower, tower_pk)
    if not tower:
        raise HTTPException(status_code=404, detail="Tower not found")
    has_visits = db.query(Visit).filter(Visit.tower_id == tower_pk).first() is not None
    if has_visits:
        tower.is_active = False
        db.commit()
    else:
        db.delete(tower)
        db.commit()
    return None


@router.post("/{tower_pk}/photo", response_model=TowerOut)
async def upload_tower_photo(
    tower_pk: int, file: UploadFile = File(...), db: Session = Depends(get_db), _user: User = Depends(get_current_user)
):
    """A single reference/context photo of the tower structure itself — separate from the
    per-position inspection evidence images uploaded under /api/images."""
    tower = db.get(Tower, tower_pk)
    if not tower:
        raise HTTPException(status_code=404, detail="Tower not found")

    raw = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB limit")
    if file.content_type not in ACCEPTED_IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    ext = file_extension(file.filename, file.content_type)
    rel_path = tower_photo_relative_path(tower.tower_id, ext)
    rel_path, _size, _checksum = save_upload(raw, rel_path, base_dir=settings.tower_photos_dir)
    thumb_path = build_thumbnail(
        rel_path, source_base_dir=settings.tower_photos_dir, thumb_base_dir=settings.tower_photo_thumbnails_dir
    )

    tower.photo_path = rel_path
    tower.photo_thumbnail_path = thumb_path
    tower.photo_original_filename = file.filename
    tower.photo_uploaded_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    db.refresh(tower)
    return tower


@router.delete("/{tower_pk}/photo", response_model=TowerOut)
def clear_tower_photo(tower_pk: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    tower = db.get(Tower, tower_pk)
    if not tower:
        raise HTTPException(status_code=404, detail="Tower not found")
    if tower.photo_path:
        path = settings.tower_photos_dir / tower.photo_path
        if path.exists():
            path.unlink()
    if tower.photo_thumbnail_path:
        tpath = settings.tower_photo_thumbnails_dir / tower.photo_thumbnail_path
        if tpath.exists():
            tpath.unlink()
    tower.photo_path = None
    tower.photo_thumbnail_path = None
    tower.photo_original_filename = None
    tower.photo_uploaded_at = None
    db.commit()
    db.refresh(tower)
    return tower


@router.get("/{tower_pk}/photo")
def get_tower_photo(tower_pk: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    tower = db.get(Tower, tower_pk)
    if not tower or not tower.photo_path:
        raise HTTPException(status_code=404, detail="No photo uploaded for this tower")
    path = settings.tower_photos_dir / tower.photo_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Photo missing from storage")
    return FileResponse(path, headers={"Cache-Control": "no-cache"})


@router.get("/{tower_pk}/photo/thumbnail")
def get_tower_photo_thumbnail(tower_pk: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    tower = db.get(Tower, tower_pk)
    if not tower or not tower.photo_thumbnail_path:
        raise HTTPException(status_code=404, detail="No photo uploaded for this tower")
    path = settings.tower_photo_thumbnails_dir / tower.photo_thumbnail_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail missing from storage")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})
