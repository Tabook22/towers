"""Pick the next towers a crew should hit tonight.

OHL towers sit on a line. We project them onto that line, face the direction the crew is already
moving, finish any in-progress visit first, then walk along the remaining assigned towers.
Drive time is haversine at a dirt-track speed — good enough to rank stops without calling a
routing API from the field.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models import (
    ACTIVE_CLAIM_STATUSES,
    LocationPing,
    NightTowerClaim,
    Position,
    Team,
    Tower,
    User,
    UserRole,
    Visit,
)
from app.services.movement import (
    FIELD_TZ,
    current_field_date,
    haversine_m,
    shift_window,
)
from app.services.rollup import visit_rollup

FIELD_SPEED_KMH = 35.0
DEFAULT_DWELL_MIN = 25
OPERATIONAL_END_HOUR = 6  # 06:00 Oman — typical end of the night flight window
MAX_STOPS = 8


@dataclass
class Candidate:
    id: int
    tower_id: str
    area: str | None
    latitude: float
    longitude: float
    status: str
    visit_id: int | None


def _en_meters(lat: float, lon: float, o_lat: float, o_lon: float) -> tuple[float, float]:
    east = haversine_m(o_lat, o_lon, o_lat, lon) * (1.0 if lon >= o_lon else -1.0)
    north = haversine_m(o_lat, o_lon, lat, o_lon) * (1.0 if lat >= o_lat else -1.0)
    return east, north


def principal_axis(points: list[tuple[float, float]]) -> tuple[tuple[float, float], tuple[float, float]]:
    """Origin + unit (east, north) along the two farthest towers — the transmission-line axis."""
    if not points:
        return (0.0, 0.0), (1.0, 0.0)
    if len(points) == 1:
        return points[0], (1.0, 0.0)
    best_d = -1.0
    a = b = points[0]
    for i, p in enumerate(points):
        for q in points[i + 1 :]:
            d = haversine_m(p[0], p[1], q[0], q[1])
            if d > best_d:
                best_d = d
                a, b = p, q
    east, north = _en_meters(b[0], b[1], a[0], a[1])
    # Keep +axis pointing roughly east so a heading_sign of +1 means "continue east along the line".
    if east < 0:
        a, b = b, a
        east, north = -east, -north
    length = math.hypot(east, north) or 1.0
    return a, (east / length, north / length)


def project_1d(lat: float, lon: float, origin: tuple[float, float], axis: tuple[float, float]) -> float:
    east, north = _en_meters(lat, lon, origin[0], origin[1])
    return east * axis[0] + north * axis[1]


def travel_minutes(km: float, speed_kmh: float = FIELD_SPEED_KMH) -> int:
    if km <= 0:
        return 0
    return max(1, int(round((km / speed_kmh) * 60)))


def order_along_line(
    origin: tuple[float, float],
    remaining: list[Candidate],
    all_points: list[tuple[float, float]],
    heading_sign: float,
) -> list[Candidate]:
    """Walk remaining towers along the line in the crew's travel direction, then the other way."""
    if not remaining:
        return []
    axis_origin, axis = principal_axis(all_points or [(c.latitude, c.longitude) for c in remaining])
    here = project_1d(origin[0], origin[1], axis_origin, axis)
    indexed = [(project_1d(c.latitude, c.longitude, axis_origin, axis), c) for c in remaining]
    ahead = sorted([(p, c) for p, c in indexed if (p - here) * heading_sign >= 0], key=lambda t: t[0] * heading_sign)
    behind = sorted([(p, c) for p, c in indexed if (p - here) * heading_sign < 0], key=lambda t: -t[0] * heading_sign)
    # If nothing is strictly ahead (standing past the last tower), just go toward the nearest cluster.
    if not ahead:
        return [c for _, c in behind]
    return [c for _, c in ahead] + [c for _, c in behind]


def plan_stops(
    origin: tuple[float, float],
    remaining: list[Candidate],
    all_points: list[tuple[float, float]],
    heading_sign: float,
    limit: int,
    dwell_min: int,
    lead: list[Candidate] | None = None,
) -> list[dict]:
    lead = list(lead or [])
    lead_ids = {c.id for c in lead}
    in_progress = [c for c in remaining if c.status == "in_progress" and c.id not in lead_ids]
    pending = [c for c in remaining if c.status != "in_progress" and c.id not in lead_ids]
    in_progress.sort(key=lambda c: haversine_m(origin[0], origin[1], c.latitude, c.longitude))
    ordered = lead + in_progress + order_along_line(origin, pending, all_points, heading_sign)
    # Drop duplicates if an in-progress tower also appeared in pending (shouldn't).
    seen: set[int] = set()
    unique: list[Candidate] = []
    for c in ordered:
        if c.id in seen:
            continue
        seen.add(c.id)
        unique.append(c)
    unique = unique[:limit]

    stops: list[dict] = []
    prev = origin
    cumulative = 0
    for i, c in enumerate(unique):
        km = round(haversine_m(prev[0], prev[1], c.latitude, c.longitude) / 1000.0, 2)
        drive = travel_minutes(km)
        cumulative += drive
        if c.id in lead_ids:
            reason = "You claimed this — go here first"
        elif c.status == "in_progress":
            reason = "Finish the visit already open here"
        elif i == len(lead) + len(in_progress):
            reason = "Next along the line from where you are"
        else:
            reason = "Then continue along the line"
        stops.append(
            {
                "rank": i + 1,
                "id": c.id,
                "tower_id": c.tower_id,
                "area": c.area,
                "latitude": c.latitude,
                "longitude": c.longitude,
                "status": c.status,
                "visit_id": c.visit_id,
                "travel_km": km,
                "travel_minutes": drive,
                "dwell_minutes": dwell_min,
                "cumulative_minutes": cumulative + dwell_min,
                "reason": reason,
            }
        )
        cumulative += dwell_min
        prev = (c.latitude, c.longitude)
    return stops


def _operational_end_utc(field_date: dt.date) -> dt.datetime:
    """06:00 Oman the morning after field_date if still night; otherwise the 18:00 shift end."""
    dawn_local = dt.datetime(
        field_date.year, field_date.month, field_date.day, OPERATIONAL_END_HOUR, tzinfo=FIELD_TZ
    ) + dt.timedelta(days=1)
    dawn_utc = dawn_local.astimezone(dt.timezone.utc).replace(tzinfo=None)
    _start, shift_end = shift_window(field_date)
    now = dt.datetime.utcnow()
    if now < dawn_utc:
        return dawn_utc
    return shift_end


def _latest_status(visit: Visit | None) -> tuple[str, int | None]:
    if visit is None:
        return "pending", None
    if visit_rollup(visit)["visit_status"] == "Ready for review":
        return "completed", visit.id
    return "in_progress", visit.id


def build_next_towers(
    db: Session,
    team: Team,
    user: User | None,
    latitude: float | None,
    longitude: float | None,
    limit: int = 5,
) -> dict:
    limit = max(1, min(limit, MAX_STOPS))
    day = current_field_date()
    shift_start, shift_end = shift_window(day)
    towers = (
        db.query(Tower)
        .filter(Tower.is_active.is_(True), Tower.assigned_team_id == team.id)
        .order_by(Tower.tower_id)
        .all()
    )
    with_coords = [t for t in towers if t.latitude is not None and t.longitude is not None]
    all_points = [(t.latitude, t.longitude) for t in with_coords]

    latest_visit: dict[int, Visit] = {}
    if towers:
        visits = (
            db.query(Visit)
            .options(joinedload(Visit.positions).joinedload(Position.images))
            .filter(Visit.team_id == team.id, Visit.tower_id.in_([t.id for t in towers]))
            .order_by(Visit.inspection_date.desc().nullslast(), Visit.id.desc())
            .all()
        )
        for v in visits:
            latest_visit.setdefault(v.tower_id, v)

    remaining: list[Candidate] = []
    completed = in_progress = pending = 0
    skipped_no_gps = 0
    for t in towers:
        status, visit_id = _latest_status(latest_visit.get(t.id))
        if status == "completed":
            completed += 1
            continue
        if status == "in_progress":
            in_progress += 1
        else:
            pending += 1
        if t.latitude is None or t.longitude is None:
            skipped_no_gps += 1
            continue
        remaining.append(
            Candidate(
                id=t.id,
                tower_id=t.tower_id,
                area=t.area,
                latitude=t.latitude,
                longitude=t.longitude,
                status=status,
                visit_id=visit_id,
            )
        )

    claims = (
        db.query(NightTowerClaim)
        .options(joinedload(NightTowerClaim.assigned_user))
        .filter(NightTowerClaim.team_id == team.id, NightTowerClaim.field_date == day)
        .all()
    )
    claims_by_tower = {c.tower_pk: c for c in claims}
    skipped_ids = {c.tower_pk for c in claims if c.status == "skipped"}
    done_claim_ids = {c.tower_pk for c in claims if c.status == "done"}
    remaining = [c for c in remaining if c.id not in skipped_ids and c.id not in done_claim_ids]
    viewer_id = user.id if user and user.role == UserRole.TEAM_MEMBER.value else None
    if viewer_id is not None:
        remaining = [
            c
            for c in remaining
            if not (
                (cl := claims_by_tower.get(c.id))
                and cl.status in ACTIVE_CLAIM_STATUSES
                and cl.assigned_user_id != viewer_id
            )
        ]
        lead = [
            c
            for c in remaining
            if (cl := claims_by_tower.get(c.id))
            and cl.status in ACTIVE_CLAIM_STATUSES
            and cl.assigned_user_id == viewer_id
        ]
    else:
        lead = []

    origin, origin_source, origin_label, heading_sign = _resolve_origin(
        db, team, user, latitude, longitude, remaining, with_coords
    )

    tonight_ids = {
        row[0]
        for row in db.query(Visit.tower_id)
        .filter(Visit.team_id == team.id, Visit.created_at >= shift_start, Visit.created_at < shift_end)
        .distinct()
    }
    tonight_ids |= done_claim_ids
    done_tonight = len(tonight_ids)
    target = team.daily_target
    behind_by = (target - done_tonight) if target else None

    end = _operational_end_utc(day)
    now = dt.datetime.utcnow()
    minutes_left = max(0, int((end - now).total_seconds() / 60)) if now < shift_end else 0
    still_night = now < (
        dt.datetime(day.year, day.month, day.day, OPERATIONAL_END_HOUR, tzinfo=FIELD_TZ) + dt.timedelta(days=1)
    ).astimezone(dt.timezone.utc).replace(tzinfo=None)

    stops: list[dict] = []
    if origin is not None and remaining:
        stops = plan_stops(origin, remaining, all_points, heading_sign, limit, DEFAULT_DWELL_MIN, lead=lead)
        for s in stops:
            s["fits_tonight"] = s["cumulative_minutes"] <= minutes_left if minutes_left else False
            cl = claims_by_tower.get(s["id"])
            if cl:
                who = cl.assigned_user
                s["claim_id"] = cl.id
                s["claim_status"] = cl.status
                s["claimed_by_id"] = cl.assigned_user_id
                s["claimed_by_name"] = (who.full_name or who.username) if who else None
                s["mine"] = bool(user and cl.assigned_user_id == user.id)
                s["skip_reason"] = cl.skip_reason
                if cl.visit_id and not s.get("visit_id"):
                    s["visit_id"] = cl.visit_id
                if cl.status in ACTIVE_CLAIM_STATUSES and not s["mine"] and who:
                    s["reason"] = f"Taken by {s['claimed_by_name']}"
            else:
                s["claim_id"] = None
                s["claim_status"] = None
                s["claimed_by_id"] = None
                s["claimed_by_name"] = None
                s["mine"] = False
                s["skip_reason"] = None

    can_fit = sum(1 for s in stops if s.get("fits_tonight"))
    here_name = _here_name(origin, remaining + [
        Candidate(t.id, t.tower_id, t.area, t.latitude or 0, t.longitude or 0, "completed", None)
        for t in with_coords
    ])
    headline = _headline(
        here_name or origin_label,
        pending + in_progress,
        minutes_left,
        still_night,
        behind_by,
        done_tonight,
        target,
    )

    return {
        "team_id": team.id,
        "team_name": team.name,
        "field_date": day,
        "origin_latitude": origin[0] if origin else None,
        "origin_longitude": origin[1] if origin else None,
        "origin_source": origin_source,
        "origin_label": origin_label,
        "minutes_left": minutes_left,
        "still_night": still_night,
        "daily_target": target,
        "towers_done_tonight": done_tonight,
        "behind_by": behind_by,
        "remaining_assigned": pending + in_progress,
        "in_progress": in_progress,
        "pending": pending,
        "completed": completed,
        "skipped_no_gps": skipped_no_gps,
        "can_fit_tonight": can_fit,
        "dwell_minutes": DEFAULT_DWELL_MIN,
        "headline": headline,
        "stops": stops,
        "crew": [
            {
                "user_id": u.id,
                "username": u.username,
                "full_name": u.full_name,
                "role": u.role,
            }
            for u in team.users
            if u.is_active
        ],
    }


def _here_name(origin: tuple[float, float] | None, candidates: list[Candidate]) -> str | None:
    if origin is None:
        return None
    best: Candidate | None = None
    best_d = 120.0
    for c in candidates:
        d = haversine_m(origin[0], origin[1], c.latitude, c.longitude)
        if d < best_d:
            best, best_d = c, d
    return best.tower_id if best else None


def _headline(
    here: str | None,
    remaining: int,
    minutes_left: int,
    still_night: bool,
    behind_by: int | None,
    done_tonight: int,
    target: int | None,
) -> str:
    hours = minutes_left / 60.0
    time_bit = (
        f"{hours:.1f} hours of darkness left"
        if still_night
        else f"{hours:.1f} hours left in this field night"
    )
    if remaining == 0:
        loc = f"You're at {here}. " if here else ""
        return f"{loc}Assigned towers for this team are done. {time_bit}."
    loc = f"You're at {here}. " if here else ""
    pace = ""
    if target:
        if behind_by is not None and behind_by > 0:
            pace = f" Behind tonight's target by {behind_by} ({done_tonight}/{target})."
        elif behind_by is not None and behind_by <= 0:
            pace = f" On target for tonight ({done_tonight}/{target})."
    return f"{loc}{remaining} assigned tower{'s' if remaining != 1 else ''} still open, {time_bit}.{pace}"


def _resolve_origin(
    db: Session,
    team: Team,
    user: User | None,
    latitude: float | None,
    longitude: float | None,
    remaining: list[Candidate],
    located: list[Tower],
) -> tuple[tuple[float, float] | None, str, str, float]:
    heading = 1.0
    if latitude is not None and longitude is not None:
        origin = (latitude, longitude)
        heading_uid = _team_user_near(db, team, origin) or (user.id if user else None)
        heading = _heading_from_pings(db, heading_uid, origin, remaining, located)
        return origin, "device", "This phone", heading

    ping = None
    if user is not None:
        ping = (
            db.query(LocationPing)
            .filter(LocationPing.user_id == user.id)
            .order_by(LocationPing.recorded_at.desc())
            .first()
        )
    if ping is None:
        user_ids = [u.id for u in team.users]
        if user_ids:
            ping = (
                db.query(LocationPing)
                .filter(LocationPing.user_id.in_(user_ids))
                .order_by(LocationPing.recorded_at.desc())
                .first()
            )
    if ping is not None:
        origin = (ping.latitude, ping.longitude)
        heading = _heading_from_pings(db, ping.user_id, origin, remaining, located)
        who = (ping.user.full_name or ping.user.username) if ping.user else "Crew GPS"
        return origin, "gps", who, heading

    if remaining:
        # Stand at the first in-progress, else the first remaining along tower_id order.
        first = next((c for c in remaining if c.status == "in_progress"), remaining[0])
        return (first.latitude, first.longitude), "tower", first.tower_id, 1.0
    if located:
        t = located[0]
        return (t.latitude, t.longitude), "tower", t.tower_id, 1.0
    return None, "none", "Unknown", 1.0


def _team_user_near(db: Session, team: Team, origin: tuple[float, float]) -> int | None:
    """The team login whose latest ping is at this origin — so heading follows the crew, not dispatch."""
    user_ids = [u.id for u in team.users]
    if not user_ids:
        return None
    latest_at = (
        db.query(LocationPing.user_id, func.max(LocationPing.recorded_at).label("max_at"))
        .filter(LocationPing.user_id.in_(user_ids))
        .group_by(LocationPing.user_id)
        .subquery()
    )
    pings = (
        db.query(LocationPing)
        .join(
            latest_at,
            (LocationPing.user_id == latest_at.c.user_id) & (LocationPing.recorded_at == latest_at.c.max_at),
        )
        .all()
    )
    best_id = None
    best_d = 200.0
    for ping in pings:
        d = haversine_m(origin[0], origin[1], ping.latitude, ping.longitude)
        if d < best_d:
            best_d = d
            best_id = ping.user_id
    return best_id


def _heading_from_pings(
    db: Session,
    user_id: int | None,
    origin: tuple[float, float],
    remaining: list[Candidate],
    located: list[Tower],
) -> float:
    points = [(t.latitude, t.longitude) for t in located] or [(c.latitude, c.longitude) for c in remaining]
    axis_origin, axis = principal_axis(points) if points else ((origin[0], origin[1]), (1.0, 0.0))
    here = project_1d(origin[0], origin[1], axis_origin, axis)
    prev_point = None
    if user_id is not None:
        prev = (
            db.query(LocationPing)
            .filter(LocationPing.user_id == user_id)
            .order_by(LocationPing.recorded_at.desc())
            .offset(1)
            .first()
        )
        if prev is not None:
            prev_point = (prev.latitude, prev.longitude)
    if prev_point is not None:
        prev_1d = project_1d(prev_point[0], prev_point[1], axis_origin, axis)
        delta = here - prev_1d
        if abs(delta) > 30:  # metres along the line — ignore GPS jitter
            return 1.0 if delta > 0 else -1.0
    if remaining:
        mid = sum(project_1d(c.latitude, c.longitude, axis_origin, axis) for c in remaining) / len(remaining)
        if abs(mid - here) > 30:
            return 1.0 if mid > here else -1.0
    return 1.0
