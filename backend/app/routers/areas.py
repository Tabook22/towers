"""Full CRUD for the Area catalog (see models.Area) — add/rename/delete the named regions towers
belong to (e.g. "Ashoor-Saada", "Ittin-Thumrait"). `Tower.area` itself stays a plain string (every
existing filter/report/dashboard that reads it keeps working unchanged) — this is just the
admin-managed source of truth for which names exist, and the mechanism that keeps a rename in sync
across every tower currently carrying the old name.

GET is open to any signed-in role (the same dropdown everywhere else in the app already is);
add/rename/delete are admin/reviewer only, same boundary as towers.py's own write endpoints.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permission_level
from app.models import Area, Tower, User, UserRole
from app.schemas import AreaCreate, AreaOut, AreaUpdate

router = APIRouter(prefix="/api/areas", tags=["areas"])


def _area_out(db: Session, area: Area) -> AreaOut:
    out = AreaOut.model_validate(area)
    out.tower_count = db.query(Tower).filter(Tower.area == area.name).count()
    return out


@router.get("", response_model=list[AreaOut])
def list_areas(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    areas = db.query(Area).order_by(Area.name).all()
    return [_area_out(db, a) for a in areas]


@router.post("", response_model=AreaOut, status_code=201)
def create_area(
    payload: AreaCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_permission_level("manage_towers", "add", UserRole.REVIEWER.value)),
):
    name = payload.name.strip()
    if db.query(Area).filter(Area.name.ilike(name)).first():
        raise HTTPException(status_code=400, detail=f"An area named '{name}' already exists")
    area = Area(name=name, notes=payload.notes)
    db.add(area)
    db.commit()
    db.refresh(area)
    return _area_out(db, area)


@router.patch("/{area_id}", response_model=AreaOut)
def update_area(
    area_id: int,
    payload: AreaUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_permission_level("manage_towers", "full", UserRole.REVIEWER.value)),
):
    area = db.get(Area, area_id)
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    data = payload.model_dump(exclude_unset=True)
    new_name = data.get("name")
    if new_name is not None:
        new_name = new_name.strip()
        clash = db.query(Area).filter(Area.name.ilike(new_name), Area.id != area_id).first()
        if clash:
            raise HTTPException(status_code=400, detail=f"An area named '{new_name}' already exists")
        if new_name != area.name:
            # Keep every tower currently carrying the old name in sync with the rename — otherwise
            # they'd silently fall out of this area (and its dropdown/filter) the moment it's renamed.
            db.query(Tower).filter(Tower.area == area.name).update({"area": new_name})
        data["name"] = new_name
    for k, v in data.items():
        setattr(area, k, v)
    db.commit()
    db.refresh(area)
    return _area_out(db, area)


@router.delete("/{area_id}", status_code=204)
def delete_area(
    area_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_permission_level("manage_towers", "full", UserRole.REVIEWER.value)),
):
    area = db.get(Area, area_id)
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    # Clear it off any tower still carrying it rather than blocking the delete — the frontend
    # confirms this with the admin first (see TowersPage.tsx's delete handler) since it's the whole
    # point of the "remove them before deleting" flow: no separate reassign-each-tower step needed.
    db.query(Tower).filter(Tower.area == area.name).update({"area": None})
    db.delete(area)
    db.commit()
    return None
