"""Team management: rosters, missions, and a day-by-day progress log per team.

A Team is a real-world field crew (leader + members, mostly without logins of their own) — separate
from `User`, which just says "which team does this login's device/pings count toward" via
`User.team_id`.

A mission is NOT a separate record from a visit — it IS a Visit, with `Visit.team_id` and
`Visit.mission_seq` set (see models.Visit). "Assign Team Alpha's Mission 3" and "log an inspection
visit to tower X" are the same action; everything a visit already carries — positions, the 48-shot
checklist, screening, annotations, the free-form photo gallery, reports — is automatically part of
the mission with no duplicate data entry. This router's mission endpoints are thin, team-scoped
wrappers around the visits router (see create_visit_row/attach_rollup imports below); editing a
mission's fields, uploading its photos, or deleting it is done through the normal `/api/visits/...`
endpoints once you have its id.

Progress (towers visited, screened, hotspots) is always computed live from the team's Visits —
never stored — so it can't drift out of sync with the actual inspection data. `TeamDailyLog` holds
only the qualitative side: notes, delays, handovers — the things a team leader would phone in that
no visit record captures.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user, require_role, require_team_scope
from app.models import LineInspectionReport, LocationPing, Position, Team, TeamDailyLog, TeamMember, Tower, User, UserRole, Visit
from app.routers.visits import _load_visit, attach_rollup, create_visit_row, delete_visit_completely
from app.schemas import (
    LiveTeamMember,
    TeamCreate,
    TeamDailyLogCreate,
    TeamDailyLogOut,
    TeamDayProgress,
    TeamJobMap,
    TeamJobMapTower,
    TeamMemberCreate,
    TeamMemberOut,
    TeamMemberUpdate,
    TeamOut,
    TeamTodayProgress,
    TeamUpdate,
    VisitCreate,
    VisitDetail,
    VisitOut,
)
from app.services.rollup import visit_rollup

router = APIRouter(prefix="/api/teams", tags=["teams"])

STALE_AFTER_MINUTES = 30


def _team_out(team: Team) -> TeamOut:
    out = TeamOut.model_validate(team)
    out.linked_user_count = len(team.users)
    out.mission_count = len(team.visits)
    return out


def _assign_leader(db: Session, team: Team, leader_user_id: int | None) -> None:
    """Links (or unlinks, if None) a team-leader login as this team's leader. Once linked, it's the
    authoritative source for `leader_name`/`leader_phone` — auto-filled here from the account's
    profile so anything already reading those two plain-text fields keeps working unchanged.
    Reassigning a leader who currently leads a *different* team moves them here automatically,
    detaching them (and that team's own leader_user_id) from wherever they were before, rather than
    leaving two teams both pointing at the same login."""
    if team.leader_user_id == leader_user_id:
        return
    if team.leader_user_id:
        prev = db.get(User, team.leader_user_id)
        if prev and prev.team_id == team.id:
            prev.team_id = None
    team.leader_user_id = leader_user_id
    if leader_user_id is None:
        return
    leader = db.get(User, leader_user_id)
    if not leader:
        raise HTTPException(status_code=404, detail="Team leader account not found")
    if leader.role != UserRole.TEAM_LEADER.value:
        raise HTTPException(status_code=400, detail="That account isn't a team-leader login")
    if leader.team_id and leader.team_id != team.id:
        other = db.get(Team, leader.team_id)
        if other and other.leader_user_id == leader.id:
            other.leader_user_id = None
    leader.team_id = team.id
    team.leader_name = leader.full_name or leader.username
    team.leader_phone = leader.mobile


def _load_team(db: Session, team_id: int) -> Team:
    team = (
        db.query(Team)
        .options(joinedload(Team.members), joinedload(Team.users))
        .filter(Team.id == team_id)
        .first()
    )
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.get("", response_model=list[TeamOut])
def list_teams(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    include_inactive: bool = False,
):
    # A team_member's whole app is their own assigned missions (see routers/visits.py) — not team
    # management, which this listing is for. Nothing here they need, so it's just refused outright
    # rather than narrowed, the same way dashboard/archive/team-activity are for this role.
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    q = db.query(Team).options(joinedload(Team.members), joinedload(Team.users))
    if not include_inactive:
        q = q.filter(Team.is_active.is_(True))
    # A team_leader's workspace is their own team, full stop — this list is the one place a
    # cross-team leak would be easy to miss, since every other endpoint takes a team_id in the path.
    if user.role == UserRole.TEAM_LEADER.value:
        q = q.filter(Team.id == user.team_id) if user.team_id else q.filter(False)
    teams = q.order_by(Team.name).all()
    return [_team_out(t) for t in teams]


@router.post("", response_model=TeamOut, status_code=201)
def create_team(
    payload: TeamCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    if db.query(Team).filter(Team.name.ilike(payload.name)).first():
        raise HTTPException(status_code=400, detail=f"A team named '{payload.name}' already exists")
    data = payload.model_dump(exclude={"members", "leader_user_id"})
    team = Team(**data, created_by=user.id)
    db.add(team)
    db.flush()
    for m in payload.members:
        db.add(TeamMember(team_id=team.id, **m.model_dump()))
    _assign_leader(db, team, payload.leader_user_id)
    db.commit()
    return _team_out(_load_team(db, team.id))


@router.get("/{team_id}", response_model=TeamOut)
def get_team(team_id: int, db: Session = Depends(get_db), _user: User = Depends(require_team_scope())):
    return _team_out(_load_team(db, team_id))


@router.patch("/{team_id}", response_model=TeamOut)
def update_team(
    team_id: int,
    payload: TeamUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    team = _load_team(db, team_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        clash = db.query(Team).filter(Team.name.ilike(data["name"]), Team.id != team_id).first()
        if clash:
            raise HTTPException(status_code=400, detail=f"A team named '{data['name']}' already exists")
    leader_provided = "leader_user_id" in data
    leader_value = data.pop("leader_user_id", None)
    for k, v in data.items():
        setattr(team, k, v)
    if leader_provided:
        _assign_leader(db, team, leader_value)
    db.commit()
    return _team_out(_load_team(db, team_id))


@router.delete("/{team_id}", status_code=204)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """Deleting a team is total, by design: every mission it ever ran (its Visits — positions,
    images, photos, all of it, files on disk included), every team-leader/team-member LOGIN linked
    to it, its roster and daily log, and any official report generated for it are all destroyed
    along with it. Nothing "belonging" to the team survives — this is deliberately NOT the soft
    archive teams used to get; an admin who deletes a team means gone.

    Towers are the one exception: they're real physical infrastructure that outlives any one team,
    so they're just unassigned (Tower.assigned_team_id cleared) rather than deleted — their own
    inspection history (from this or any other team) is untouched. Cannot be undone, so the
    frontend confirms — with the actual counts below — before calling this."""
    team = _load_team(db, team_id)

    # Team.leader_user_id -> users.id and User.team_id -> teams.id point at each other, so deleting
    # both the team and its linked users in the same flush is a genuine circular dependency as far
    # as SQLAlchemy's delete-ordering is concerned — break the cycle explicitly first.
    team.leader_user_id = None
    db.flush()

    # Every mission this team ran — full delete (DB rows + files on disk), same as a single visit's
    # own DELETE /api/visits/{id} endpoint.
    visits = (
        db.query(Visit)
        .options(joinedload(Visit.positions).joinedload(Position.images), joinedload(Visit.photos))
        .filter(Visit.team_id == team_id)
        .all()
    )
    for v in visits:
        delete_visit_completely(db, v)

    # Every login tied to this team — leader and team_member roster alike — plus their GPS-ping
    # history, which is meaningless once the account is gone.
    linked_users = db.query(User).filter(User.team_id == team_id).all()
    linked_user_ids = [u.id for u in linked_users]
    if linked_user_ids:
        db.query(LocationPing).filter(LocationPing.user_id.in_(linked_user_ids)).delete(synchronize_session=False)
    for u in linked_users:
        db.delete(u)
    db.flush()

    db.query(Tower).filter(Tower.assigned_team_id == team_id).update({"assigned_team_id": None})
    db.query(LineInspectionReport).filter(LineInspectionReport.team_id == team_id).delete()
    db.delete(team)  # cascades to TeamMember/TeamDailyLog rows (relationship cascade="all, delete-orphan")
    db.commit()
    return None


# ---------- Roster ----------
@router.post("/{team_id}/members", response_model=TeamMemberOut, status_code=201)
def add_member(
    team_id: int,
    payload: TeamMemberCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    _load_team(db, team_id)  # 404 if missing
    member = TeamMember(team_id=team_id, **payload.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.patch("/{team_id}/members/{member_id}", response_model=TeamMemberOut)
def update_member(
    team_id: int,
    member_id: int,
    payload: TeamMemberUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    member = db.query(TeamMember).filter(TeamMember.id == member_id, TeamMember.team_id == team_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(member, k, v)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/{team_id}/members/{member_id}", status_code=204)
def remove_member(
    team_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    member = db.query(TeamMember).filter(TeamMember.id == member_id, TeamMember.team_id == team_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    db.delete(member)
    db.commit()
    return None


# ---------- Daily log (qualitative notes) ----------
@router.post("/{team_id}/notes", response_model=TeamDailyLogOut, status_code=201)
def add_note(
    team_id: int,
    payload: TeamDailyLogCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_scope()),
):
    _load_team(db, team_id)
    log = TeamDailyLog(team_id=team_id, created_by=user.id, **payload.model_dump())
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.delete("/{team_id}/notes/{note_id}", status_code=204)
def delete_note(
    team_id: int,
    note_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    log = db.query(TeamDailyLog).filter(TeamDailyLog.id == note_id, TeamDailyLog.team_id == team_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(log)
    db.commit()
    return None


# ---------- Missions: a team-scoped view onto its Visits — see module docstring. Editing a
# mission's own fields, its photos, or deleting it all happen through /api/visits/{id}/... once
# you have the id (every mission row the frontend shows links straight to /visits/{id}). ----------
@router.get("/{team_id}/missions", response_model=list[VisitOut])
def list_missions(team_id: int, db: Session = Depends(get_db), _user: User = Depends(require_team_scope())):
    _load_team(db, team_id)
    visits = (
        db.query(Visit)
        .options(
            joinedload(Visit.positions).joinedload(Position.images),
            joinedload(Visit.tower),
            joinedload(Visit.team),
            joinedload(Visit.photos),
            joinedload(Visit.assigned_member),
        )
        .filter(Visit.team_id == team_id)
        .order_by(Visit.mission_seq)
        .all()
    )
    return [attach_rollup(v) for v in visits]


@router.post("/{team_id}/missions", response_model=VisitDetail, status_code=201)
def create_mission(
    team_id: int,
    payload: VisitCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_scope()),
):
    """Creates the mission as a real Visit already tied to this team and numbered (Mission 1, 2,
    3...) — go straight to /visits/{id} afterward to run it: positions, images, screening, all of it."""
    _load_team(db, team_id)
    next_seq = (db.query(func.max(Visit.mission_seq)).filter(Visit.team_id == team_id).scalar() or 0) + 1
    payload = payload.model_copy(update={"team_id": team_id})
    visit = create_visit_row(payload, db, user)
    visit.mission_seq = next_seq
    db.commit()
    return attach_rollup(_load_visit(db, visit.id), detail=True)


# ---------- Job map: the team's whole assigned scope of work, not just what's been visited so far
# ---------- (contrast with the missions list above, which is only the Visits that already exist) ----------
@router.get("/{team_id}/job-map", response_model=TeamJobMap)
def team_job_map(team_id: int, db: Session = Depends(get_db), _user: User = Depends(require_team_scope())):
    """Every active tower the admin has directly assigned to this team (Tower.assigned_team_id),
    plotted with its status for THIS team — completed / in progress / not started yet. This is the
    "full job" view a leader (or field crew, planning where to fly next) needs: not just the towers
    already visited (that's the dashboard/missions list), but the entire scope they're responsible
    for, so progress can be measured against the whole job, not just what's been done so far. A
    team with nothing assigned yet just yields an empty map — assign towers from the Towers page."""
    team = _load_team(db, team_id)

    towers = (
        db.query(Tower)
        .filter(Tower.is_active.is_(True), Tower.assigned_team_id == team_id)
        .order_by(Tower.tower_id)
        .all()
    )
    if not towers:
        return TeamJobMap()
    rows: list[TeamJobMapTower] = []
    completed = in_progress = pending = 0
    for t in towers:
        visit = (
            db.query(Visit)
            .filter(Visit.tower_id == t.id, Visit.team_id == team_id)
            .order_by(Visit.inspection_date.desc().nullslast(), Visit.id.desc())
            .first()
        )
        if not visit:
            status = "pending"
            pending += 1
            visit_id = None
        else:
            if visit_rollup(visit)["visit_status"] == "Ready for review":
                status = "completed"
                completed += 1
            else:
                status = "in_progress"
                in_progress += 1
            visit_id = visit.id
        rows.append(
            TeamJobMapTower(
                id=t.id, tower_id=t.tower_id, area=t.area, latitude=t.latitude, longitude=t.longitude,
                status=status, visit_id=visit_id,
            )
        )
    return TeamJobMap(sector=team.primary_sector, total=len(towers), completed=completed, in_progress=in_progress, pending=pending, towers=rows)


# ---------- Progress: day-by-day achievement, straight from the team's own Visits ----------
@router.get("/{team_id}/progress", response_model=list[TeamDayProgress])
def team_progress(
    team_id: int,
    start_date: dt.date | None = Query(default=None),
    end_date: dt.date | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    team = _load_team(db, team_id)
    today = dt.datetime.now(dt.timezone.utc).date()
    end = end_date or team.end_date or today
    start = start_date or team.start_date or (end - dt.timedelta(days=6))
    if end < start:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    if (end - start).days > 90:
        raise HTTPException(status_code=400, detail="Date range too wide — ask for at most 90 days at a time")

    user_ids = [u.id for u in team.users]  # still used for GPS ping start/finish time below

    notes_by_date: dict[dt.date, list[TeamDailyLog]] = {}
    for log in db.query(TeamDailyLog).filter(TeamDailyLog.team_id == team_id, TeamDailyLog.log_date >= start, TeamDailyLog.log_date <= end):
        notes_by_date.setdefault(log.log_date, []).append(log)

    # All this team's visits in range, grouped by date — a mission belongs to the team via
    # Visit.team_id directly now, regardless of which linked login happened to save it.
    range_visits = (
        db.query(Visit)
        .options(joinedload(Visit.positions).joinedload(Position.images))
        .filter(Visit.team_id == team_id, Visit.inspection_date >= start, Visit.inspection_date <= end)
        .all()
    )
    visits_by_date: dict[dt.date, list[Visit]] = {}
    for v in range_visits:
        visits_by_date.setdefault(v.inspection_date, []).append(v)

    days: list[TeamDayProgress] = []
    d = start
    while d <= end:
        visits = visits_by_date.get(d, [])
        towers = {v.tower_id for v in visits}
        screened = 0
        hotspots = 0
        images_captured = 0
        for v in visits:
            r = visit_rollup(v)
            screened += r["screened"]
            hotspots += r["hotspots"]
            for p in v.positions:
                images_captured += sum(1 for img in p.images if img.file_path)

        first_seen = last_seen = None
        if user_ids:
            day_start = dt.datetime.combine(d, dt.time.min)
            day_end = dt.datetime.combine(d, dt.time.max)
            pings = (
                db.query(LocationPing)
                .filter(LocationPing.user_id.in_(user_ids), LocationPing.recorded_at >= day_start, LocationPing.recorded_at <= day_end)
                .order_by(LocationPing.recorded_at.asc())
                .all()
            )
            if pings:
                first_seen = pings[0].recorded_at
                last_seen = pings[-1].recorded_at

        days.append(
            TeamDayProgress(
                log_date=d,
                towers_visited=len(towers),
                visits_touched=len(visits),
                screened=screened,
                hotspots=hotspots,
                images_captured=images_captured,
                first_seen=first_seen,
                last_seen=last_seen,
                notes=[TeamDailyLogOut.model_validate(n) for n in notes_by_date.get(d, [])],
            )
        )
        d += dt.timedelta(days=1)

    days.reverse()  # most recent day first — that's what a manager checking in wants to see first
    return days


@router.get("/{team_id}/live", response_model=list[LiveTeamMember])
def team_live(
    team_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    """Same shape as /api/tracking/live but scoped to one team's linked logins — for the team detail
    page's own small map, so it doesn't need every other team's dots to show just this one."""
    team = _load_team(db, team_id)
    now = dt.datetime.now(dt.timezone.utc)
    stale_cutoff = now - dt.timedelta(minutes=STALE_AFTER_MINUTES)
    today = now.date()

    out: list[LiveTeamMember] = []
    for user in team.users:
        ping = (
            db.query(LocationPing)
            .filter(LocationPing.user_id == user.id)
            .order_by(LocationPing.recorded_at.desc())
            .first()
        )
        if not ping:
            continue
        recorded_at = ping.recorded_at if ping.recorded_at.tzinfo else ping.recorded_at.replace(tzinfo=dt.timezone.utc)
        visits_today = (
            db.query(Visit)
            .options(joinedload(Visit.positions).joinedload(Position.images))
            .filter(Visit.created_by == user.id, Visit.inspection_date == today)
            .all()
        )
        screened = sum(visit_rollup(v)["screened"] for v in visits_today)
        hotspots = sum(visit_rollup(v)["hotspots"] for v in visits_today)
        out.append(
            LiveTeamMember(
                user_id=user.id,
                username=user.username,
                full_name=user.full_name,
                team_id=team.id,
                team_name=team.name,
                latitude=ping.latitude,
                longitude=ping.longitude,
                accuracy_m=ping.accuracy_m,
                last_seen=ping.recorded_at,
                is_stale=recorded_at < stale_cutoff,
                today=TeamTodayProgress(
                    towers_visited=len({v.tower_id for v in visits_today}),
                    visits_touched=len(visits_today),
                    screened=screened,
                    hotspots=hotspots,
                ),
            )
        )
    return out
