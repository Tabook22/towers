"""Field tracking: GPS breadcrumbs from technicians' devices while they're out inspecting, plus a
same-day progress rollup per user. There's no separate "Team" entity — each field crew is expected
to share one login on one phone, so a User row IS a team for tracking purposes (see models.LocationPing
for the reasoning). The frontend's `useFieldTracking` hook posts a ping every so often while the app
is open; the Field Tracker page polls `/live` for the dispatcher-facing board and fetches `/trail` for
one user's breadcrumb line only when that user is selected on the map.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user, require_role
from app.models import LocationPing, Position, User, UserRole, Visit
from app.schemas import LiveTeamMember, LocationPingCreate, TeamTodayProgress, TrailPoint
from app.services.rollup import visit_rollup

router = APIRouter(prefix="/api/tracking", tags=["tracking"])

# A user with no ping in this long is shown greyed-out on the board ("probably not tracking
# anymore") rather than removed outright — a supervisor should still see where they last were.
STALE_AFTER_MINUTES = 30


@router.post("/ping", status_code=204)
def send_ping(payload: LocationPingCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.add(LocationPing(user_id=user.id, **payload.model_dump()))
    db.commit()
    return None


def _today_progress(db: Session, user_id: int, on_date: dt.date) -> TeamTodayProgress:
    visits = (
        db.query(Visit)
        .options(joinedload(Visit.positions).joinedload(Position.images))
        .filter(Visit.created_by == user_id, Visit.inspection_date == on_date)
        .all()
    )
    towers = {v.tower_id for v in visits}
    screened = 0
    hotspots = 0
    for v in visits:
        r = visit_rollup(v)
        screened += r["screened"]
        hotspots += r["hotspots"]
    return TeamTodayProgress(
        towers_visited=len(towers), visits_touched=len(visits), screened=screened, hotspots=hotspots
    )


@router.get("/live", response_model=list[LiveTeamMember])
def live_teams(
    db: Session = Depends(get_db),
    _viewer: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
    on_date: dt.date | None = Query(default=None),
):
    """Latest ping per user who has sent one, newest first. `on_date` (default today) controls which
    day's progress numbers are attached — lets a supervisor look back at "how did Tuesday go"."""
    day = on_date or dt.datetime.now(dt.timezone.utc).date()
    now = dt.datetime.now(dt.timezone.utc)
    stale_cutoff = now - dt.timedelta(minutes=STALE_AFTER_MINUTES)

    # Latest ping per user: SQLite has no DISTINCT ON, so just walk pings newest-first and keep the
    # first one seen per user — simplest thing that works at field-team scale (dozens of users, not
    # millions of pings).
    latest_by_user: dict[int, LocationPing] = {}
    for ping in db.query(LocationPing).order_by(LocationPing.recorded_at.desc()).all():
        latest_by_user.setdefault(ping.user_id, ping)

    out: list[LiveTeamMember] = []
    for user_id, ping in latest_by_user.items():
        user = db.get(User, user_id)
        if not user:
            continue
        recorded_at = ping.recorded_at if ping.recorded_at.tzinfo else ping.recorded_at.replace(tzinfo=dt.timezone.utc)
        out.append(
            LiveTeamMember(
                user_id=user.id,
                username=user.username,
                full_name=user.full_name,
                team_id=user.team_id,
                team_name=user.team.name if user.team else None,
                latitude=ping.latitude,
                longitude=ping.longitude,
                accuracy_m=ping.accuracy_m,
                last_seen=ping.recorded_at,
                is_stale=recorded_at < stale_cutoff,
                today=_today_progress(db, user.id, day),
            )
        )
    out.sort(key=lambda m: m.last_seen, reverse=True)
    return out


@router.get("/trail", response_model=list[TrailPoint])
def user_trail(
    user_id: int,
    on_date: dt.date | None = Query(default=None),
    db: Session = Depends(get_db),
    _viewer: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """One user's ordered pings for a day — draw as a polyline for their movement trail along the line."""
    day = on_date or dt.datetime.now(dt.timezone.utc).date()
    start = dt.datetime.combine(day, dt.time.min)
    end = dt.datetime.combine(day, dt.time.max)
    pings = (
        db.query(LocationPing)
        .filter(LocationPing.user_id == user_id, LocationPing.recorded_at >= start, LocationPing.recorded_at <= end)
        .order_by(LocationPing.recorded_at.asc())
        .all()
    )
    return [TrailPoint(latitude=p.latitude, longitude=p.longitude, recorded_at=p.recorded_at) for p in pings]
