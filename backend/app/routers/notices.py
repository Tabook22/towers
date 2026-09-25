"""Scoped field announcements with explicit receipts and reversible task/archive states."""
import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import case, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.deps import effective_team_id, get_current_user, has_permission_level
from app.models import FieldNotice, NoticeAcknowledgement, Team, Tower, User, Visit

router = APIRouter(prefix="/api/notices", tags=["noticeboard"])
STAFF = ("admin", "reviewer", "team_leader", "team_member", "inspector")


def today():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=4))).date()


def now():
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def staff(user: User = Depends(get_current_user)):
    if user.role not in STAFF:
        raise HTTPException(403, "The noticeboard is for internal staff")
    return user


def publisher(user):
    return user.role in ("reviewer", "team_leader") or (
        has_permission_level(user, "manage_teams", "full") and
        (user.is_super_admin or "teams" in user.menu_permissions))


def manageable(row, user):
    return publisher(user) and (user.role != "team_leader" or
                               (row.team_id == user.team_id and row.created_by == user.id))


def visible_query(db, user):
    staff(user)
    q = db.query(FieldNotice)
    if user.role not in ("admin", "reviewer"):
        tid = effective_team_id(db, user)
        q = q.filter(or_(FieldNotice.team_id.is_(None), FieldNotice.team_id == tid))
    return q


def active_query(q):
    return q.filter(FieldNotice.archived_at.is_(None), FieldNotice.completed_at.is_(None),
                    or_(FieldNotice.expires_on.is_(None), FieldNotice.expires_on >= today()))


def loaded(q):
    return q.options(joinedload(FieldNotice.team), joinedload(FieldNotice.tower),
        joinedload(FieldNotice.owner), joinedload(FieldNotice.author), joinedload(FieldNotice.finisher),
        selectinload(FieldNotice.acknowledgements))


def get_notice(db, user, notice_id):
    row = loaded(visible_query(db, user)).filter(FieldNotice.id == notice_id).first()
    if not row:
        raise HTTPException(404, "Notice not found")
    return row


def name(user):
    return user.full_name or user.username if user else None


def status(row):
    if row.archived_at:
        return "archived"
    if row.completed_at:
        return "completed"
    if row.expires_on and row.expires_on < today():
        return "expired"
    return "active"


def output(row, user):
    acks = [a for a in row.acknowledgements if a.revision == row.revision]
    return {"id": row.id, "title": row.title, "body": row.body, "category": row.category,
        "team_id": row.team_id, "team_name": row.team.name if row.team else None,
        "tower_id": row.tower_id, "tower_name": row.tower.tower_id if row.tower else None,
        "owner_id": row.owner_id, "owner_name": name(row.owner), "author_name": name(row.author),
        "due_on": row.due_on, "expires_on": row.expires_on, "created_at": row.created_at,
        "updated_at": row.updated_at, "completed_at": row.completed_at, "completed_by_name": name(row.finisher),
        "version": row.version, "revision": row.revision, "status": status(row),
        "acknowledged": any(a.user_id == user.id for a in acks), "acknowledgement_count": len(acks),
        "can_manage": manageable(row, user),
        "can_complete": row.category == "action" and status(row) == "active" and
            (manageable(row, user) or row.owner_id in (None, user.id))}


class NoticeInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=4000)
    category: Literal["urgent", "action", "update"] = "update"
    team_id: int | None = None
    tower_id: int | None = None
    owner_id: int | None = None
    due_on: dt.date | None = None
    expires_on: dt.date | None = None

    @field_validator("title", "body", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def check_dates(self):
        if self.expires_on and self.expires_on < today():
            raise ValueError("Expiry must be today or later")
        if self.due_on and self.expires_on and self.due_on > self.expires_on:
            raise ValueError("Expiry must be on or after the due date")
        if self.category != "action" and (self.owner_id or self.due_on):
            raise ValueError("Only action notes can have an owner or due date")
        return self


class NoticeEdit(NoticeInput):
    expected_version: int


class NoticeState(BaseModel):
    action: Literal["archive", "restore", "complete", "reopen"]
    expected_version: int


class AcknowledgeInput(BaseModel):
    revision: int


def validate_target(db, user, payload):
    if not publisher(user):
        raise HTTPException(403, "Only managers and team leaders can publish notices")
    tid = effective_team_id(db, user)
    if user.role == "team_leader" and (not tid or payload.team_id != tid):
        raise HTTPException(403, "Team leaders can publish only to their own team")
    if payload.team_id is not None and not db.get(Team, payload.team_id):
        raise HTTPException(422, "Choose an existing team")
    if payload.owner_id is not None:
        owner = db.get(User, payload.owner_id)
        if not owner or not owner.is_active or not owner.is_approved or owner.role not in STAFF:
            raise HTTPException(422, "Choose an active staff member")
        if payload.team_id and owner.team_id != payload.team_id:
            raise HTTPException(422, "The action owner must belong to the selected team")
    if payload.tower_id is not None:
        tower = db.get(Tower, payload.tower_id)
        if not tower:
            raise HTTPException(422, "Choose an existing tower")
        if payload.team_id and tower.assigned_team_id != payload.team_id and not db.query(Visit.id).filter(
            Visit.team_id == payload.team_id, Visit.tower_id == tower.id).first():
            raise HTTPException(422, "Choose a tower assigned to or inspected by this team")


@router.get("/options")
def options(db: Session = Depends(get_db), user: User = Depends(staff)):
    tid = effective_team_id(db, user)
    can_publish = publisher(user) and (user.role != "team_leader" or bool(tid))
    if not can_publish:
        return {"can_publish": False, "can_broadcast": False, "teams": [], "people": [], "towers": []}
    teams = db.query(Team)
    people = db.query(User).filter(User.is_active.is_(True), User.is_approved.is_(True), User.role.in_(STAFF))
    towers = db.query(Tower)
    if user.role == "team_leader":
        teams = teams.filter(Team.id == tid)
        people = people.filter(User.team_id == tid)
        towers = towers.filter(or_(Tower.assigned_team_id == tid, Tower.id.in_(db.query(Visit.tower_id).filter(Visit.team_id == tid))))
    visit_teams = {}
    for tower_id, team_id in db.query(Visit.tower_id, Visit.team_id).filter(Visit.team_id.isnot(None)).distinct():
        if user.role != "team_leader" or team_id == tid:
            visit_teams.setdefault(tower_id, set()).add(team_id)
    return {"can_publish": True, "can_broadcast": user.role != "team_leader",
        "teams": [{"id": t.id, "name": t.name} for t in teams.order_by(Team.name)],
        "people": [{"id": p.id, "name": name(p), "team_id": p.team_id} for p in people.order_by(User.full_name)],
        "towers": [{"id": t.id, "name": t.tower_id, "team_id": t.assigned_team_id,
                    "team_ids": sorted(visit_teams.get(t.id, set()) | ({t.assigned_team_id} if t.assigned_team_id else set()))}
                   for t in towers.order_by(Tower.tower_id)]}


@router.get("")
def history(state: Literal["active", "history"] = "active", search: str = "", category: str | None = None,
            offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50),
            db: Session = Depends(get_db), user: User = Depends(staff)):
    base = visible_query(db, user)
    active = active_query(base)
    unacked = active.filter(FieldNotice.category == "urgent", ~FieldNotice.acknowledgements.any(
        (NoticeAcknowledgement.user_id == user.id) & (NoticeAcknowledgement.revision == FieldNotice.revision)))
    urgent = loaded(unacked.order_by(FieldNotice.created_at.desc(), FieldNotice.id.desc())).first()
    q = active if state == "active" else base.filter(or_(FieldNotice.archived_at.isnot(None),
        FieldNotice.completed_at.isnot(None), FieldNotice.expires_on < today()))
    if search.strip():
        q = q.filter(or_(FieldNotice.title.contains(search.strip(), autoescape=True), FieldNotice.body.contains(search.strip(), autoescape=True)))
    if category in ("urgent", "action", "update"):
        q = q.filter(FieldNotice.category == category)
    total = q.count()
    rows = loaded(q).order_by(case((FieldNotice.category == "urgent", 0), (FieldNotice.category == "action", 1), else_=2),
        FieldNotice.due_on.asc().nullslast(), FieldNotice.created_at.desc(), FieldNotice.id.desc()).offset(offset).limit(limit).all()
    return {"items": [output(r, user) for r in rows], "total": total, "active_count": active.count(),
            "can_publish": publisher(user) and (user.role != "team_leader" or bool(user.team_id)),
            "urgent_unacknowledged": unacked.count(), "urgent": output(urgent, user) if urgent else None}


@router.post("", status_code=201)
def create(payload: NoticeInput, db: Session = Depends(get_db), user: User = Depends(staff)):
    validate_target(db, user, payload)
    row = FieldNotice(**payload.model_dump(), created_by=user.id)
    db.add(row); db.commit()
    return output(get_notice(db, user, row.id), user)


def change(db, row, version, values):
    values.update(updated_at=now(), version=FieldNotice.version + 1)
    changed = db.query(FieldNotice).filter(FieldNotice.id == row.id, FieldNotice.version == version).update(values, synchronize_session=False)
    if not changed:
        db.rollback()
        raise HTTPException(409, "This notice changed. Refresh the board before trying again.")
    db.commit()
    db.expire_all()


@router.put("/{notice_id}")
def edit(notice_id: int, payload: NoticeEdit, db: Session = Depends(get_db), user: User = Depends(staff)):
    row = get_notice(db, user, notice_id)
    if not manageable(row, user):
        raise HTTPException(403, "You cannot edit this notice")
    validate_target(db, user, payload)
    change(db, row, payload.expected_version, {**payload.model_dump(exclude={"expected_version"}), "revision": FieldNotice.revision + 1})
    return output(get_notice(db, user, notice_id), user)


@router.post("/{notice_id}/acknowledge")
def acknowledge(notice_id: int, payload: AcknowledgeInput, db: Session = Depends(get_db), user: User = Depends(staff)):
    row = get_notice(db, user, notice_id)
    if row.revision != payload.revision:
        raise HTTPException(409, "This notice was edited. Read the latest version before acknowledging.")
    if status(row) != "active":
        raise HTTPException(409, "This notice is no longer active")
    if not any(a.user_id == user.id and a.revision == row.revision for a in row.acknowledgements):
        db.add(NoticeAcknowledgement(notice_id=row.id, user_id=user.id, revision=row.revision))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if not db.query(NoticeAcknowledgement.id).filter_by(notice_id=notice_id, user_id=user.id, revision=payload.revision).first():
                raise
    db.expire_all()
    return output(get_notice(db, user, notice_id), user)


@router.post("/{notice_id}/state")
def set_state(notice_id: int, payload: NoticeState, db: Session = Depends(get_db), user: User = Depends(staff)):
    row = get_notice(db, user, notice_id)
    if payload.action == "complete":
        if not output(row, user)["can_complete"]:
            raise HTTPException(403, "Only the action owner or a manager can complete this action")
        values = {"completed_at": now(), "completed_by": user.id}
    else:
        if not manageable(row, user):
            raise HTTPException(403, "You cannot manage this notice")
        values = {"archived_at": now()} if payload.action == "archive" else {"archived_at": None} if payload.action == "restore" else {"completed_at": None, "completed_by": None}
    change(db, row, payload.expected_version, values)
    return output(get_notice(db, user, notice_id), user)


@router.get("/{notice_id}/receipts")
def receipts(notice_id: int, db: Session = Depends(get_db), user: User = Depends(staff)):
    row = get_notice(db, user, notice_id)
    if not manageable(row, user):
        raise HTTPException(403, "Only notice managers can view acknowledgements")
    audience = db.query(User).filter(User.is_active.is_(True), User.is_approved.is_(True), User.role.in_(STAFF))
    if row.team_id:
        audience = audience.filter(or_(User.team_id == row.team_id, User.role.in_(("admin", "reviewer"))))
    acks = {a.user_id: a.acknowledged_at for a in row.acknowledgements if a.revision == row.revision}
    return {"revision": row.revision, "people": [{"id": p.id, "name": name(p), "acknowledged_at": acks.get(p.id)}
        for p in audience.order_by(User.full_name, User.username)]}
