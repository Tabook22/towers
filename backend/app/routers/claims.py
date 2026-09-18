"""Tonight's tower claims — who is going where, so two cars don't stack on one pin."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import require_team_read
from app.models import (
    ACTIVE_CLAIM_STATUSES,
    CHANNEL_KIND_DEFAULT_BODY,
    CLAIM_STATUS_CHOICES,
    NightTowerClaim,
    Team,
    TeamChannelMessage,
    Tower,
    User,
    UserRole,
    Visit,
    utcnow,
)
from app.schemas import NightClaimCreate, NightClaimOut, NightClaimUpdate
from app.services.channel import resolve_location
from app.services.movement import current_field_date

router = APIRouter(prefix="/api/teams", tags=["claims"])


def _load_team(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


def _can_assign(user: User, team_id: int) -> bool:
    if user.role in (UserRole.ADMIN.value, UserRole.REVIEWER.value):
        return True
    return user.role == UserRole.TEAM_LEADER.value and user.team_id == team_id


def _team_login_ids(db: Session, team_id: int) -> set[int]:
    rows = db.query(User.id).filter(User.team_id == team_id, User.is_active.is_(True)).all()
    return {r[0] for r in rows}


def _claim_out(row: NightTowerClaim) -> NightClaimOut:
    who = row.assigned_user
    tower = row.tower
    return NightClaimOut(
        id=row.id,
        team_id=row.team_id,
        field_date=row.field_date,
        tower_id=row.tower_pk,
        tower_code=tower.tower_id if tower else None,
        assigned_user_id=row.assigned_user_id,
        assigned_user_name=(who.full_name or who.username) if who else None,
        status=row.status,
        skip_reason=row.skip_reason,
        visit_id=row.visit_id,
        claimed_at=row.claimed_at,
        arrived_at=row.arrived_at,
        completed_at=row.completed_at,
    )


def _load_claim(db: Session, team_id: int, claim_id: int) -> NightTowerClaim:
    row = (
        db.query(NightTowerClaim)
        .options(joinedload(NightTowerClaim.assigned_user), joinedload(NightTowerClaim.tower))
        .filter(NightTowerClaim.id == claim_id, NightTowerClaim.team_id == team_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Claim not found")
    return row


def _post_skip_channel(db: Session, team_id: int, user: User, tower_pk: int, reason: str) -> None:
    lat = lng = None
    tower = db.get(Tower, tower_pk)
    if tower and tower.latitude is not None:
        lat, lng = tower.latitude, tower.longitude
    tagged_tower, visit_id, lat, lng = resolve_location(db, team_id, tower_pk, lat, lng)
    db.add(
        TeamChannelMessage(
            team_id=team_id,
            field_date=current_field_date(),
            kind="skip",
            body=reason or CHANNEL_KIND_DEFAULT_BODY["skip"],
            tower_pk=tagged_tower or tower_pk,
            visit_id=visit_id,
            latitude=lat,
            longitude=lng,
            created_by=user.id,
        )
    )


@router.get("/{team_id}/claims", response_model=list[NightClaimOut])
def list_claims(
    team_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    _load_team(db, team_id)
    day = current_field_date()
    rows = (
        db.query(NightTowerClaim)
        .options(joinedload(NightTowerClaim.assigned_user), joinedload(NightTowerClaim.tower))
        .filter(NightTowerClaim.team_id == team_id, NightTowerClaim.field_date == day)
        .order_by(NightTowerClaim.id.asc())
        .all()
    )
    return [_claim_out(r) for r in rows]


@router.post("/{team_id}/claims", response_model=NightClaimOut, status_code=201)
def create_claim(
    team_id: int,
    payload: NightClaimCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    _load_team(db, team_id)
    tower = db.get(Tower, payload.tower_id)
    if tower is None or not tower.is_active:
        raise HTTPException(status_code=404, detail="Tower not found")
    if tower.assigned_team_id != team_id:
        raise HTTPException(status_code=400, detail="That tower isn't assigned to this team")
    assignee_id = payload.assigned_user_id or user.id
    if assignee_id != user.id and not _can_assign(user, team_id):
        raise HTTPException(status_code=403, detail="You can only claim a tower for yourself")
    allowed = _team_login_ids(db, team_id)
    allowed.add(user.id)
    if assignee_id not in allowed:
        raise HTTPException(status_code=400, detail="That login isn't on this team")

    day = current_field_date()
    existing = (
        db.query(NightTowerClaim)
        .options(joinedload(NightTowerClaim.assigned_user), joinedload(NightTowerClaim.tower))
        .filter(
            NightTowerClaim.team_id == team_id,
            NightTowerClaim.field_date == day,
            NightTowerClaim.tower_pk == payload.tower_id,
        )
        .first()
    )
    now = utcnow()
    if existing:
        if existing.status in ACTIVE_CLAIM_STATUSES and existing.assigned_user_id != assignee_id:
            if not _can_assign(user, team_id):
                who = existing.assigned_user
                name = (who.full_name or who.username) if who else "someone else"
                raise HTTPException(status_code=409, detail=f"Already taken by {name}")
        existing.assigned_user_id = assignee_id
        existing.status = "claimed"
        existing.skip_reason = None
        existing.claimed_at = now
        existing.arrived_at = None
        existing.completed_at = None
        existing.created_by = user.id
        db.commit()
        return _claim_out(_load_claim(db, team_id, existing.id))

    row = NightTowerClaim(
        team_id=team_id,
        field_date=day,
        tower_pk=payload.tower_id,
        assigned_user_id=assignee_id,
        status="claimed",
        claimed_at=now,
        created_by=user.id,
    )
    db.add(row)
    db.commit()
    return _claim_out(_load_claim(db, team_id, row.id))


@router.patch("/{team_id}/claims/{claim_id}", response_model=NightClaimOut)
def update_claim(
    team_id: int,
    claim_id: int,
    payload: NightClaimUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    row = _load_claim(db, team_id, claim_id)
    if row.assigned_user_id != user.id and not _can_assign(user, team_id):
        raise HTTPException(status_code=403, detail="That's someone else's tower")
    data = payload.model_dump(exclude_unset=True)
    if "assigned_user_id" in data and data["assigned_user_id"] is not None:
        if not _can_assign(user, team_id):
            raise HTTPException(status_code=403, detail="You can only claim a tower for yourself")
        allowed = _team_login_ids(db, team_id)
        if data["assigned_user_id"] not in allowed:
            raise HTTPException(status_code=400, detail="That login isn't on this team")
        row.assigned_user_id = data["assigned_user_id"]
        row.status = "claimed"
        row.claimed_at = utcnow()
        row.arrived_at = None
        row.completed_at = None
    if "status" in data and data["status"] is not None:
        status = data["status"]
        if status not in CLAIM_STATUS_CHOICES:
            raise HTTPException(status_code=400, detail=f"status must be one of {CLAIM_STATUS_CHOICES}")
        row.status = status
        now = utcnow()
        if status == "on_site" and row.arrived_at is None:
            row.arrived_at = now
        if status in ("done", "skipped"):
            row.completed_at = now
        if status == "skipped":
            reason = (data.get("skip_reason") or row.skip_reason or "").strip()
            if not reason or reason.casefold() == CHANNEL_KIND_DEFAULT_BODY["skip"].casefold():
                raise HTTPException(status_code=400, detail="A short explanation is required to skip a tower")
            row.skip_reason = reason
            _post_skip_channel(db, team_id, user, row.tower_pk, reason)
        if status == "claimed":
            row.arrived_at = None
            row.completed_at = None
            row.skip_reason = None
    if "skip_reason" in data and data["skip_reason"] is not None:
        row.skip_reason = data["skip_reason"]
    if "visit_id" in data and data["visit_id"] is not None:
        visit = db.get(Visit, data["visit_id"])
        if visit is None or visit.team_id != team_id:
            raise HTTPException(status_code=400, detail="Visit is not this team's")
        row.visit_id = visit.id
        if row.status in ("claimed", "en_route"):
            row.status = "on_site"
            row.arrived_at = row.arrived_at or utcnow()
    db.commit()
    return _claim_out(_load_claim(db, team_id, row.id))
