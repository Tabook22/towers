"""Turn raw GPS pings into a day's path and time spent at each tower.

A stay is a run of consecutive pings whose nearest tower (within RADIUS_M) is the same tower.
Duration is last ping minus first ping, plus one heartbeat interval so a single ping at a tower
still counts as about a minute on site.
"""
from __future__ import annotations

import datetime as dt
import math
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, joinedload

from app.models import LocationPing, Tower, User, Visit

# Night crews start ~22:00 and finish ~05:00 Oman time. A calendar midnight split would cut
# one shift into two paths. The field day runs 18:00–18:00 Asia/Muscat so 22:00→05:00 is one track.
FIELD_TZ = ZoneInfo("Asia/Muscat")
SHIFT_START_HOUR = 18

EARTH_M = 6_371_000
RADIUS_M = 80  # "at this tower" — walking around the base still counts
MAX_ACCURACY_M = 5_000
MAX_JUMP_M = 2_500
HEARTBEAT_SECONDS = 60
# Collapse two stays on the same tower if they overlap or the GPS only dropped off for a short
# flicker. A genuine return hours later is a second visit and must stay a separate row.
MERGE_GAP_SECONDS = 15 * 60


def current_field_date(when: dt.datetime | None = None) -> dt.date:
    """Which night-shift label is 'now': before 18:00 local it is still last night's field day."""
    now = when.astimezone(FIELD_TZ) if when else dt.datetime.now(FIELD_TZ)
    if now.hour < SHIFT_START_HOUR:
        now = now - dt.timedelta(days=1)
    return now.date()


def shift_window(field_date: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """Naive-UTC [start, end) covering 18:00 field_date → 18:00 next day in Oman."""
    start_local = dt.datetime(
        field_date.year, field_date.month, field_date.day, SHIFT_START_HOUR, tzinfo=FIELD_TZ
    )
    end_local = start_local + dt.timedelta(days=1)
    start_utc = start_local.astimezone(dt.timezone.utc).replace(tzinfo=None)
    end_utc = end_local.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return start_utc, end_utc


def _local_on_shift(field_date: dt.date, hour: int, minute: int = 0) -> dt.datetime:
    """Hour on the field night: 18–23 is the evening of field_date; 0–17 is the next morning."""
    day = field_date if hour >= SHIFT_START_HOUR else field_date + dt.timedelta(days=1)
    return dt.datetime(day.year, day.month, day.day, hour, minute, tzinfo=FIELD_TZ)


def hour_window(
    field_date: dt.date,
    from_hour: int | None = None,
    to_hour: int | None = None,
    from_minute: int = 0,
    to_minute: int = 0,
) -> tuple[dt.datetime, dt.datetime]:
    """Optional hour slice inside a field night (Oman time). 22→05 wraps past midnight."""
    shift_start, shift_end = shift_window(field_date)
    if from_hour is None and to_hour is None:
        return shift_start, shift_end
    start_h = SHIFT_START_HOUR if from_hour is None else from_hour
    start_local = _local_on_shift(field_date, start_h, from_minute)
    if to_hour is None:
        end_local = shift_end.replace(tzinfo=dt.timezone.utc).astimezone(FIELD_TZ)
    else:
        end_local = _local_on_shift(field_date, to_hour, to_minute)
        if end_local <= start_local:
            end_local = end_local + dt.timedelta(days=1)
    start_utc = start_local.astimezone(dt.timezone.utc).replace(tzinfo=None)
    end_utc = end_local.astimezone(dt.timezone.utc).replace(tzinfo=None)
    start_utc = max(start_utc, shift_start)
    end_utc = min(end_utc, shift_end)
    if end_utc <= start_utc:
        return shift_start, shift_end
    return start_utc, end_utc


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    to_rad = math.radians
    dlat = to_rad(lat2 - lat1)
    dlon = to_rad(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_M * math.asin(math.sqrt(a))


def _aware(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value


def clean_pings(pings: list[LocationPing]) -> list[LocationPing]:
    """Drop impossible accuracy readings. Teleport jumps stay in the list (a new chain) so the
    map can still show where the crew jumped to; distance/drawing skip the bridging segment."""
    kept: list[LocationPing] = []
    for ping in pings:
        if ping.accuracy_m is not None and ping.accuracy_m > MAX_ACCURACY_M:
            continue
        kept.append(ping)
    return kept


def _nearest_tower(lat: float, lng: float, towers: list[Tower]) -> tuple[Tower | None, float]:
    best: Tower | None = None
    best_d = float("inf")
    for tower in towers:
        if tower.latitude is None or tower.longitude is None:
            continue
        d = haversine_m(lat, lng, tower.latitude, tower.longitude)
        if d < best_d:
            best, best_d = tower, d
    if best is None or best_d > RADIUS_M:
        return None, best_d
    return best, best_d


def _path_distance_km(pings: list[LocationPing]) -> float:
    total = 0.0
    for prev, cur in zip(pings, pings[1:]):
        d = haversine_m(prev.latitude, prev.longitude, cur.latitude, cur.longitude)
        if d <= MAX_JUMP_M:
            total += d
    return round(total / 1000.0, 2)


def build_day_report(
    db: Session,
    on_date: dt.date,
    start: dt.datetime | None = None,
    end: dt.datetime | None = None,
    team_id: int | None = None,
) -> list[dict]:
    if start is None or end is None:
        start, end = shift_window(on_date)
    towers = db.query(Tower).filter(Tower.is_active.is_(True)).all()
    user_q = db.query(User).options(joinedload(User.team))
    if team_id is not None:
        user_q = user_q.filter(User.team_id == team_id)
    users = {u.id: u for u in user_q.all()}

    ping_q = db.query(LocationPing).filter(LocationPing.recorded_at >= start, LocationPing.recorded_at < end)
    if team_id is not None:
        ping_q = ping_q.filter(LocationPing.user_id.in_(list(users.keys()) or [0]))
    pings = ping_q.order_by(LocationPing.user_id.asc(), LocationPing.recorded_at.asc()).all()
    by_user: dict[int, list[LocationPing]] = {}
    for ping in pings:
        by_user.setdefault(ping.user_id, []).append(ping)

    visits = (
        db.query(Visit)
        .options(joinedload(Visit.tower))
        .filter(Visit.created_at >= start, Visit.created_at < end)
        .all()
    )
    visits_by_user_tower: dict[tuple[int, int], Visit] = {}
    for visit in visits:
        if visit.created_by and visit.tower_id:
            visits_by_user_tower[(visit.created_by, visit.tower_id)] = visit
        if visit.team_id and visit.tower_id:
            for user in users.values():
                if user.team_id == visit.team_id:
                    visits_by_user_tower.setdefault((user.id, visit.tower_id), visit)

    reports: list[dict] = []
    for user_id, raw in by_user.items():
        user = users.get(user_id)
        if not user:
            continue
        cleaned = clean_pings(raw)
        if not cleaned:
            continue
        stays = _stays_for_pings(cleaned, towers, visits_by_user_tower, user_id)
        first = _aware(cleaned[0].recorded_at)
        last = _aware(cleaned[-1].recorded_at)
        minutes = max(1, int(round((last - first).total_seconds() / 60))) if len(cleaned) > 1 else 1
        reports.append(
            {
                "user_id": user.id,
                "username": user.username,
                "full_name": user.full_name,
                "team_id": user.team_id,
                "team_name": user.team.name if user.team else None,
                "first_seen": cleaned[0].recorded_at,
                "last_seen": cleaned[-1].recorded_at,
                "minutes_tracked": minutes,
                "distance_km": _path_distance_km(cleaned),
                "ping_count": len(cleaned),
                "path": [
                    {
                        "latitude": p.latitude,
                        "longitude": p.longitude,
                        "recorded_at": p.recorded_at,
                    }
                    for p in cleaned
                ],
                "stays": stays,
            }
        )
    reports.sort(key=lambda r: r["last_seen"], reverse=True)
    return reports


def _attach_travel(stays: list[dict]) -> None:
    for i, stay in enumerate(stays):
        if i == 0:
            stay["travel_from_prev_minutes"] = None
            stay["travel_from_prev_km"] = None
            continue
        prev = stays[i - 1]
        gap_sec = (_aware(stay["arrived_at"]) - _aware(prev["departed_at"])).total_seconds()
        stay["travel_from_prev_minutes"] = max(0, int(round(gap_sec / 60)))
        if prev["latitude"] is not None and prev["longitude"] is not None and stay["latitude"] is not None and stay["longitude"] is not None:
            stay["travel_from_prev_km"] = round(
                haversine_m(prev["latitude"], prev["longitude"], stay["latitude"], stay["longitude"]) / 1000.0, 2
            )
        else:
            stay["travel_from_prev_km"] = None


def _merge_stays(stays: list[dict]) -> list[dict]:
    """Collapse consecutive (or overlapping) stays on the same tower — GPS flicker off-site, or
    two logins standing at the same structure, should count as one visit not two rows."""
    ordered = sorted(stays, key=lambda s: _aware(s["arrived_at"]))
    merged: list[dict] = []
    for stay in ordered:
        item = dict(stay)
        if merged and merged[-1]["tower_pk"] == item["tower_pk"]:
            prev = merged[-1]
            gap = (_aware(item["arrived_at"]) - _aware(prev["departed_at"])).total_seconds()
            if gap <= MERGE_GAP_SECONDS:
                if _aware(item["arrived_at"]) < _aware(prev["arrived_at"]):
                    prev["arrived_at"] = item["arrived_at"]
                if _aware(item["departed_at"]) > _aware(prev["departed_at"]):
                    prev["departed_at"] = item["departed_at"]
                seconds = max(
                    HEARTBEAT_SECONDS,
                    (_aware(prev["departed_at"]) - _aware(prev["arrived_at"])).total_seconds() + HEARTBEAT_SECONDS,
                )
                prev["minutes"] = max(1, int(round(seconds / 60)))
                if item.get("visit_id") and not prev.get("visit_id"):
                    prev["visit_id"] = item["visit_id"]
                    prev["visit_status"] = item.get("visit_status")
                continue
        merged.append(item)
    return merged


def _summarize_rows(rows: list[dict], field_date: dt.date) -> dict:
    primary = max(rows, key=lambda r: r["ping_count"])
    first = min(rows, key=lambda r: r["first_seen"])
    last = max(rows, key=lambda r: r["last_seen"])
    stays = _merge_stays([s for r in rows for s in r["stays"]])
    _attach_travel(stays)
    first_pt = primary["path"][0]
    last_pt = primary["path"][-1]
    dwell = sum(s["minutes"] for s in stays)
    travel = sum(s["travel_from_prev_minutes"] or 0 for s in stays)
    span = max(1, int(round((_aware(last["last_seen"]) - _aware(first["first_seen"])).total_seconds() / 60)))
    towers = len(stays)
    return {
        "team_id": primary["team_id"],
        "team_name": primary["team_name"] or primary["full_name"] or primary["username"],
        "field_date": field_date,
        "started_at": first["first_seen"],
        "ended_at": last["last_seen"],
        "start_latitude": first_pt["latitude"],
        "start_longitude": first_pt["longitude"],
        "end_latitude": last_pt["latitude"],
        "end_longitude": last_pt["longitude"],
        "minutes_tracked": span,
        "distance_km": round(sum(r["distance_km"] for r in rows), 2) if len(rows) == 1 else primary["distance_km"],
        "towers_visited": towers,
        "dwell_minutes": dwell,
        "travel_minutes": travel,
        "avg_minutes_per_tower": round(dwell / towers, 1) if towers else 0,
        "avg_travel_minutes": round(travel / (towers - 1), 1) if towers > 1 else 0,
        "ping_count": sum(r["ping_count"] for r in rows),
        "logins": [{"user_id": r["user_id"], "username": r["username"], "full_name": r["full_name"]} for r in rows],
        "stays": stays,
        "path": primary["path"],
        "vs_previous": None,
    }


def build_team_progress(
    db: Session,
    on_date: dt.date,
    start: dt.datetime | None = None,
    end: dt.datetime | None = None,
    team_id: int | None = None,
) -> list[dict]:
    """One row per team (or unlinked login) for the field night, with travel-between-towers."""
    reports = build_day_report(db, on_date, start=start, end=end, team_id=team_id)
    groups: dict[str, list[dict]] = {}
    for row in reports:
        key = f"team-{row['team_id']}" if row["team_id"] is not None else f"user-{row['user_id']}"
        groups.setdefault(key, []).append(row)
    out = [_summarize_rows(rows, on_date) for rows in groups.values()]
    out.sort(key=lambda r: r["ended_at"], reverse=True)

    prev_date = on_date - dt.timedelta(days=1)
    prev_rows = build_day_report(db, prev_date, team_id=team_id)
    prev_groups: dict[str, list[dict]] = {}
    for row in prev_rows:
        key = f"team-{row['team_id']}" if row["team_id"] is not None else f"user-{row['user_id']}"
        prev_groups.setdefault(key, []).append(row)
    prev_sum = {k: _summarize_rows(v, prev_date) for k, v in prev_groups.items()}
    for item in out:
        key = f"team-{item['team_id']}" if item["team_id"] is not None else f"user-{item['logins'][0]['user_id']}"
        prev = prev_sum.get(key)
        if not prev:
            continue
        item["vs_previous"] = {
            "field_date": prev_date,
            "minutes_tracked_delta": item["minutes_tracked"] - prev["minutes_tracked"],
            "distance_km_delta": round(item["distance_km"] - prev["distance_km"], 2),
            "towers_delta": item["towers_visited"] - prev["towers_visited"],
            "avg_minutes_per_tower_delta": round(item["avg_minutes_per_tower"] - prev["avg_minutes_per_tower"], 1),
        }
    return out


def _stays_for_pings(
    pings: list[LocationPing],
    towers: list[Tower],
    visits_by_user_tower: dict[tuple[int, int], Visit],
    user_id: int,
) -> list[dict]:
    stays: list[dict] = []
    current_tower: Tower | None = None
    arrived: dt.datetime | None = None
    last_at: dt.datetime | None = None

    def close(tower: Tower, start: dt.datetime, finish: dt.datetime) -> None:
        seconds = max(HEARTBEAT_SECONDS, (_aware(finish) - _aware(start)).total_seconds() + HEARTBEAT_SECONDS)
        visit = visits_by_user_tower.get((user_id, tower.id))
        stays.append(
            {
                "tower_pk": tower.id,
                "tower_id": tower.tower_id,
                "area": tower.area,
                "latitude": tower.latitude,
                "longitude": tower.longitude,
                "arrived_at": start,
                "departed_at": finish,
                "minutes": max(1, int(round(seconds / 60))),
                "visit_id": visit.id if visit else None,
                "visit_status": visit.status if visit else None,
            }
        )

    for ping in pings:
        tower, _dist = _nearest_tower(ping.latitude, ping.longitude, towers)
        when = ping.recorded_at
        if tower is not None and current_tower is not None and tower.id == current_tower.id:
            last_at = when
            continue
        if current_tower is not None and arrived is not None and last_at is not None:
            close(current_tower, arrived, last_at)
        if tower is None:
            current_tower, arrived, last_at = None, None, None
            continue
        current_tower, arrived, last_at = tower, when, when

    if current_tower is not None and arrived is not None and last_at is not None:
        close(current_tower, arrived, last_at)

    return _merge_stays(stays)
