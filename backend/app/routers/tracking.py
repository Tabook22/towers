"""Field tracking: GPS breadcrumbs from technicians' devices while they're out inspecting, plus a
same-day progress rollup per user. There's no separate "Team" entity — each field crew is expected
to share one login on one phone, so a User row IS a team for tracking purposes (see models.LocationPing
for the reasoning). The frontend's `useFieldTracking` hook posts a ping every so often while the app
is open; the Field Tracker page polls `/live` for the dispatcher-facing board and fetches `/trail` for
one user's breadcrumb line only when that user is selected on the map.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user, require_role
from app.models import LocationPing, Position, TrackingMission, User, UserRole, Visit
from app.schemas import (
    LiveTeamMember,
    LocationPingCreate,
    MovementDayReportOut,
    TeamProgressOut,
    TeamTodayProgress,
    TrackingMissionOut,
    TrailPoint,
    UserTrailOut,
)
from app.services.movement import (
    FIELD_TZ,
    SHIFT_START_HOUR,
    build_day_report,
    build_team_progress,
    current_field_date,
    haversine_m,
    hour_window,
    shift_window,
)
from app.services.rollup import visit_rollup

router = APIRouter(prefix="/api/tracking", tags=["tracking"])

# A user with no ping in this long is shown greyed-out on the board ("probably not tracking
# anymore") rather than removed outright — a supervisor should still see where they last were.
STALE_AFTER_MINUTES = 2


def _naive_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(dt.timezone.utc).replace(tzinfo=None)


def _aware_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value


def _oman_span_label(start: dt.datetime, end: dt.datetime | None) -> str:
    s = _aware_utc(start).astimezone(FIELD_TZ)
    if end is None:
        return s.strftime("Mission %d %b %H:%M") + " – live"
    e = _aware_utc(end).astimezone(FIELD_TZ)
    if s.date() == e.date():
        return f"{s.strftime('%d %b %H:%M')} – {e.strftime('%H:%M')}"
    return f"{s.strftime('%d %b %H:%M')} – {e.strftime('%d %b %H:%M')}"


def _ping_count(db: Session, start: dt.datetime, end: dt.datetime | None) -> int:
    q = db.query(func.count(LocationPing.id)).filter(LocationPing.recorded_at >= start)
    if end is not None:
        q = q.filter(LocationPing.recorded_at < end)
    return int(q.scalar() or 0)


def _mission_out(db: Session, row: TrackingMission, now: dt.datetime) -> TrackingMissionOut:
    end = row.ended_at
    is_current = end is None
    return TrackingMissionOut(
        id=row.id,
        kind="mission",
        label=row.label or _oman_span_label(row.started_at, end),
        field_date=current_field_date(_aware_utc(row.started_at)),
        started_at=row.started_at,
        ended_at=end,
        is_current=is_current,
        ping_count=_ping_count(db, row.started_at, end if end is not None else now),
    )


def _field_nights_with_pings(db: Session) -> list[dt.date]:
    first = db.query(func.min(LocationPing.recorded_at)).scalar()
    last = db.query(func.max(LocationPing.recorded_at)).scalar()
    if first is None or last is None:
        return []
    nights: list[dt.date] = []
    day = current_field_date(_aware_utc(first))
    last_day = current_field_date(_aware_utc(last))
    while day <= last_day:
        start, end = shift_window(day)
        exists = (
            db.query(LocationPing.id)
            .filter(LocationPing.recorded_at >= start, LocationPing.recorded_at < end)
            .first()
        )
        if exists:
            nights.append(day)
        day += dt.timedelta(days=1)
    return nights


def _resolve_report_window(
    db: Session,
    on_date: dt.date | None,
    from_hour: int | None,
    to_hour: int | None,
    mission_id: int | None,
    from_ts: dt.datetime | None,
    to_ts: dt.datetime | None,
) -> tuple[dt.date, dt.datetime, dt.datetime]:
    if mission_id is not None:
        row = db.get(TrackingMission, mission_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Mission not found")
        start = _naive_utc(row.started_at)
        end = _naive_utc(row.ended_at) if row.ended_at is not None else dt.datetime.utcnow()
        return current_field_date(_aware_utc(row.started_at)), start, end
    if from_ts is not None:
        start = _naive_utc(from_ts)
        end = _naive_utc(to_ts) if to_ts is not None else dt.datetime.utcnow()
        if end <= start:
            end = start + dt.timedelta(minutes=1)
        return current_field_date(_aware_utc(start)), start, end
    day = on_date or current_field_date()
    start, end = hour_window(day, from_hour, to_hour)
    return day, start, end


@router.post("/ping", status_code=204)
def send_ping(payload: LocationPingCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # First GPS locks are often 5–20 km accuracy. Store them so the live pin appears; the trail
    # cleaner still drops impossible jumps when drawing the path.
    if payload.accuracy_m is not None and payload.accuracy_m > 50_000:
        return None
    last = (
        db.query(LocationPing)
        .filter(LocationPing.user_id == user.id)
        .order_by(LocationPing.recorded_at.desc())
        .first()
    )
    if last is not None:
        age = (dt.datetime.utcnow() - last.recorded_at.replace(tzinfo=None)).total_seconds()
        moved = haversine_m(last.latitude, last.longitude, payload.latitude, payload.longitude)
        # Ignore a duplicate heartbeat that hasn't actually moved and isn't a minute old yet.
        if age < 50 and moved < 8:
            return None
    db.add(LocationPing(user_id=user.id, **payload.model_dump()))
    db.commit()
    return None


def _empty_today() -> TeamTodayProgress:
    return TeamTodayProgress(towers_visited=0, visits_touched=0, screened=0, hotspots=0)


def _today_progress_by_user(db: Session, user_ids: list[int], on_date: dt.date) -> dict[int, TeamTodayProgress]:
    out = {uid: _empty_today() for uid in user_ids}
    if not user_ids:
        return out
    start, end = shift_window(on_date)
    visits = (
        db.query(Visit)
        .options(joinedload(Visit.positions).joinedload(Position.images))
        .filter(Visit.created_by.in_(user_ids), Visit.created_at >= start, Visit.created_at < end)
        .all()
    )
    grouped: dict[int, list[Visit]] = {}
    for v in visits:
        if v.created_by:
            grouped.setdefault(v.created_by, []).append(v)
    for uid, rows in grouped.items():
        screened = 0
        hotspots = 0
        for v in rows:
            r = visit_rollup(v)
            screened += r["screened"]
            hotspots += r["hotspots"]
        out[uid] = TeamTodayProgress(
            towers_visited=len({v.tower_id for v in rows}),
            visits_touched=len(rows),
            screened=screened,
            hotspots=hotspots,
        )
    return out


def _latest_pings_by_user(db: Session) -> dict[int, LocationPing]:
    """One ping per user — the latest — without loading the whole GPS history into memory."""
    latest_at = (
        db.query(LocationPing.user_id, func.max(LocationPing.recorded_at).label("max_at"))
        .group_by(LocationPing.user_id)
        .subquery()
    )
    rows = (
        db.query(LocationPing)
        .join(
            latest_at,
            (LocationPing.user_id == latest_at.c.user_id) & (LocationPing.recorded_at == latest_at.c.max_at),
        )
        .all()
    )
    latest: dict[int, LocationPing] = {}
    for ping in rows:
        latest.setdefault(ping.user_id, ping)
    return latest


@router.get("/live", response_model=list[LiveTeamMember])
def live_teams(
    db: Session = Depends(get_db),
    _viewer: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
    on_date: dt.date | None = Query(default=None),
):
    """Admin board: every field login (team leader / member, or anyone linked to a team), plus
    anyone who has reported a position. Users with no ping yet still appear as 'not reporting'
    so dispatch can see the full roster, not only phones that already locked GPS."""
    day = on_date or current_field_date()
    now = dt.datetime.now(dt.timezone.utc)
    stale_cutoff = now - dt.timedelta(minutes=STALE_AFTER_MINUTES)
    field_roles = {UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value, UserRole.INSPECTOR.value}

    latest_by_user = _latest_pings_by_user(db)
    users = db.query(User).options(joinedload(User.team)).filter(User.is_active.is_(True)).all()
    visible = [
        user
        for user in users
        if user.role in field_roles or user.team_id is not None or user.id in latest_by_user
    ]
    today_by_user = _today_progress_by_user(db, [u.id for u in visible], day)
    out: list[LiveTeamMember] = []
    for user in visible:
        ping = latest_by_user.get(user.id)
        recorded_at = None
        is_stale = True
        if ping is not None:
            recorded_at = ping.recorded_at if ping.recorded_at.tzinfo else ping.recorded_at.replace(tzinfo=dt.timezone.utc)
            is_stale = recorded_at < stale_cutoff
        out.append(
            LiveTeamMember(
                user_id=user.id,
                username=user.username,
                full_name=user.full_name,
                team_id=user.team_id,
                team_name=user.team.name if user.team else None,
                latitude=ping.latitude if ping else None,
                longitude=ping.longitude if ping else None,
                accuracy_m=ping.accuracy_m if ping else None,
                last_seen=ping.recorded_at if ping else None,
                is_stale=is_stale,
                today=today_by_user.get(user.id) or _empty_today(),
            )
        )
    out.sort(key=lambda m: (m.last_seen is None, -(m.last_seen.timestamp() if m.last_seen else 0)))
    return out


def _day_range(on_date: dt.date | None) -> tuple[dt.datetime, dt.datetime, dt.date]:
    day = on_date or current_field_date()
    start, end = shift_window(day)
    return start, end, day


def _trail_points(db: Session, user_id: int, start: dt.datetime, end: dt.datetime) -> list[TrailPoint]:
    pings = (
        db.query(LocationPing)
        .filter(LocationPing.user_id == user_id, LocationPing.recorded_at >= start, LocationPing.recorded_at <= end)
        .order_by(LocationPing.recorded_at.asc())
        .all()
    )
    return [TrailPoint(latitude=p.latitude, longitude=p.longitude, recorded_at=p.recorded_at) for p in pings]


@router.get("/trail", response_model=list[TrailPoint])
def user_trail(
    user_id: int,
    on_date: dt.date | None = Query(default=None),
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """One user's ordered pings for a day — draw as a polyline for their movement trail along the line."""
    if viewer.role not in (UserRole.ADMIN.value, UserRole.REVIEWER.value):
        if viewer.role == UserRole.TEAM_LEADER.value:
            target = db.get(User, user_id)
            if not target or target.team_id != viewer.team_id:
                raise HTTPException(status_code=403, detail="Not enough permissions")
        elif viewer.id != user_id:
            raise HTTPException(status_code=403, detail="Not enough permissions")
    start, end, _ = _day_range(on_date)
    return _trail_points(db, user_id, start, end)


@router.get("/trails", response_model=list[UserTrailOut])
def all_trails(
    on_date: dt.date | None = Query(default=None),
    db: Session = Depends(get_db),
    viewer: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """Every crew's GPS path for the day — Field Tracker draws these as polylines without extra clicks."""
    start, end, _ = _day_range(on_date)
    pings = (
        db.query(LocationPing)
        .filter(LocationPing.recorded_at >= start, LocationPing.recorded_at <= end)
        .order_by(LocationPing.user_id.asc(), LocationPing.recorded_at.asc())
        .all()
    )
    by_user: dict[int, list[TrailPoint]] = {}
    for p in pings:
        by_user.setdefault(p.user_id, []).append(
            TrailPoint(latitude=p.latitude, longitude=p.longitude, recorded_at=p.recorded_at)
        )
    out: list[UserTrailOut] = []
    users = {
        u.id: u
        for u in db.query(User).options(joinedload(User.team)).filter(User.id.in_(list(by_user.keys()))).all()
    } if by_user else {}
    for user_id, points in by_user.items():
        user = users.get(user_id)
        if not user:
            continue
        out.append(
            UserTrailOut(
                user_id=user.id,
                username=user.username,
                full_name=user.full_name,
                team_name=user.team.name if user.team else None,
                points=points,
            )
        )
    return out


@router.get("/day-report", response_model=list[MovementDayReportOut])
def day_report(
    on_date: dt.date | None = Query(default=None),
    from_hour: int | None = Query(default=None, ge=0, le=23),
    to_hour: int | None = Query(default=None, ge=0, le=23),
    team_id: int | None = Query(default=None),
    mission_id: int | None = Query(default=None),
    from_ts: dt.datetime | None = Query(default=None),
    to_ts: dt.datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    _viewer: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """History of a field night, saved mission, or exact time window. GPS rows are never deleted."""
    day, start, end = _resolve_report_window(db, on_date, from_hour, to_hour, mission_id, from_ts, to_ts)
    return build_day_report(db, day, start=start, end=end, team_id=team_id)


@router.get("/missions", response_model=list[TrackingMissionOut])
def list_missions(
    db: Session = Depends(get_db),
    _viewer: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """Saved tracking sessions plus every field night that has GPS — open any of them again anytime."""
    now = dt.datetime.utcnow()
    rows = db.query(TrackingMission).order_by(TrackingMission.started_at.desc()).all()
    out = [_mission_out(db, row, now) for row in rows]
    for night in reversed(_field_nights_with_pings(db)):
        start, end = shift_window(night)
        out.append(
            TrackingMissionOut(
                id=None,
                kind="night",
                label=f"Field night {night.isoformat()}",
                field_date=night,
                started_at=start,
                ended_at=end,
                is_current=False,
                ping_count=_ping_count(db, start, end),
            )
        )
    out.sort(key=lambda m: (not m.is_current, -_aware_utc(m.started_at).timestamp()))
    return out


@router.post("/missions", response_model=TrackingMissionOut)
def start_new_mission(
    db: Session = Depends(get_db),
    viewer: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """Close the current map session and open a blank one. Existing GPS stays stored for recall."""
    now = dt.datetime.utcnow()
    open_row = (
        db.query(TrackingMission)
        .filter(TrackingMission.ended_at.is_(None))
        .order_by(TrackingMission.started_at.desc())
        .first()
    )
    if open_row is not None:
        empty = _ping_count(db, open_row.started_at, now) == 0
        recent = (now - _naive_utc(open_row.started_at)).total_seconds() < 20
        if empty and recent:
            return _mission_out(db, open_row, now)
        open_row.ended_at = now
        open_row.label = _oman_span_label(open_row.started_at, now)
    else:
        last = db.query(TrackingMission).order_by(TrackingMission.started_at.desc()).first()
        if last is None:
            day = current_field_date()
            archive_start, _archive_end = shift_window(day)
        else:
            archive_start = _naive_utc(last.ended_at or last.started_at)
        if _ping_count(db, archive_start, now) > 0:
            db.add(
                TrackingMission(
                    label=_oman_span_label(archive_start, now),
                    started_at=archive_start,
                    ended_at=now,
                    created_by=viewer.id,
                )
            )
    n = (db.query(func.count(TrackingMission.id)).scalar() or 0) + 1
    row = TrackingMission(
        label=_oman_span_label(now, None).replace("Mission", f"Mission {n}", 1),
        started_at=now,
        ended_at=None,
        created_by=viewer.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _mission_out(db, row, now)


@router.get("/team-progress", response_model=list[TeamProgressOut])
def team_progress(
    on_date: dt.date | None = Query(default=None),
    from_hour: int | None = Query(default=None, ge=0, le=23),
    to_hour: int | None = Query(default=None, ge=0, le=23),
    team_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _viewer: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """Per-team mission recap for a field night: start/end, km, total time, dwell and travel between towers."""
    day = on_date or current_field_date()
    start, end = hour_window(day, from_hour, to_hour)
    return build_team_progress(db, day, start=start, end=end, team_id=team_id)


@router.get("/shift-info")
def shift_info(_viewer: User = Depends(get_current_user)):
    day = current_field_date()
    start, end = shift_window(day)
    return {
        "field_date": day.isoformat(),
        "start": start.isoformat() + "Z",
        "end": end.isoformat() + "Z",
        "timezone": "Asia/Muscat",
        "starts_at": f"{SHIFT_START_HOUR:02d}:00",
        "label": f"Field night of {day.isoformat()} (6:00 PM–6:00 PM Oman)",
    }
