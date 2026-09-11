"""Tag a night-channel message to the nearest assigned tower and an open visit, if any."""
from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.models import TeamChannelMessage, Tower, User, Visit
from app.schemas import ChannelMessageOut
from app.services.movement import haversine_m
from app.services.rollup import visit_rollup

TAG_RADIUS_M = 150


def nearest_assigned_tower(
    db: Session,
    team_id: int,
    latitude: float,
    longitude: float,
    radius_m: float = TAG_RADIUS_M,
) -> Tower | None:
    towers = (
        db.query(Tower)
        .filter(
            Tower.is_active.is_(True),
            Tower.assigned_team_id == team_id,
            Tower.latitude.isnot(None),
            Tower.longitude.isnot(None),
        )
        .all()
    )
    best: Tower | None = None
    best_d = radius_m
    for t in towers:
        d = haversine_m(latitude, longitude, t.latitude, t.longitude)
        if d <= best_d:
            best, best_d = t, d
    return best


def open_visit_for_tower(db: Session, team_id: int, tower_pk: int) -> Visit | None:
    visits = (
        db.query(Visit)
        .options(joinedload(Visit.positions))
        .filter(Visit.team_id == team_id, Visit.tower_id == tower_pk)
        .order_by(Visit.inspection_date.desc().nullslast(), Visit.id.desc())
        .all()
    )
    for v in visits:
        if visit_rollup(v)["visit_status"] != "Ready for review":
            return v
    return visits[0] if visits else None


def resolve_location(
    db: Session,
    team_id: int,
    tower_pk: int | None,
    latitude: float | None,
    longitude: float | None,
) -> tuple[int | None, int | None, float | None, float | None]:
    """Returns (tower_pk, visit_id, lat, lng)."""
    tower: Tower | None = None
    if tower_pk:
        tower = db.get(Tower, tower_pk)
        if tower is None or (tower.assigned_team_id != team_id and tower.assigned_team_id is not None):
            # Still allow tagging a tower this team has a visit on.
            has_visit = db.query(Visit.id).filter(Visit.team_id == team_id, Visit.tower_id == tower_pk).first()
            if not has_visit:
                tower = None
    if tower is None and latitude is not None and longitude is not None:
        tower = nearest_assigned_tower(db, team_id, latitude, longitude)
    if tower is None:
        return None, None, latitude, longitude
    lat = latitude if latitude is not None else tower.latitude
    lng = longitude if longitude is not None else tower.longitude
    visit = open_visit_for_tower(db, team_id, tower.id)
    return tower.id, (visit.id if visit else None), lat, lng


def message_out(row: TeamChannelMessage) -> ChannelMessageOut:
    author: User | None = row.author
    tower: Tower | None = row.tower
    return ChannelMessageOut(
        id=row.id,
        team_id=row.team_id,
        team_name=row.team.name if row.team else None,
        field_date=row.field_date,
        kind=row.kind,
        body=row.body or "",
        tower_id=row.tower_pk,
        tower_code=tower.tower_id if tower else None,
        visit_id=row.visit_id,
        latitude=row.latitude,
        longitude=row.longitude,
        has_photo=bool(row.photo_path),
        has_audio=bool(row.audio_path),
        duration_seconds=row.duration_seconds,
        created_by=row.created_by,
        author_name=(author.full_name or author.username) if author else None,
        author_role=author.role if author else None,
        created_at=row.created_at,
    )
