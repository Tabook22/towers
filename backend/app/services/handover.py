"""Shift handover pack: what tonight finished, what is still open, where to start next.

Computed live from the outing plan, visits, night claims, channel, GPS, and daily notes.
Ending an outing only stamps the plan (ended_at + leader note) — it does not freeze a copy.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session, joinedload

from app.models import (
    ACTIVE_CLAIM_STATUSES,
    LocationPing,
    NightTowerClaim,
    Position,
    Team,
    TeamChannelMessage,
    TeamDailyLog,
    TeamOutingPlan,
    TeamOutingTower,
    Tower,
    User,
    Visit,
)
from app.services.movement import current_field_date, shift_window
from app.services.next_towers import Candidate, plan_stops
from app.services.rollup import visit_rollup
from app.utils import natural_sort_key

REMAINING_STATUSES = ("skipped", "in_progress", "pending")
OPS_KINDS = ("access", "weather", "skip", "hotspot", "help")
LOOKBACK_NIGHTS = 14


def classify_tower(visit_status: str | None, claim_status: str | None) -> str:
    """Tonight's board status for one tower.

    Skip is a crew decision for this night, so it wins even if a visit exists.
    An open visit (evidence or screening still incomplete) stays in progress even if
    someone tapped Done on the claim board.
    """
    if claim_status == "skipped":
        return "skipped"
    if visit_status == "Ready for review":
        return "completed"
    if visit_status:
        return "in_progress"
    if claim_status == "done":
        return "completed"
    if claim_status in ACTIVE_CLAIM_STATUSES:
        return "in_progress"
    return "pending"


def _display_name(user: User | None) -> str | None:
    if user is None:
        return None
    return user.full_name or user.username


def _visit_board_status(visit: Visit | None) -> tuple[str | None, dict]:
    if visit is None:
        return None, {}
    if not visit.positions:
        return "Inspection incomplete", {
            "visit_status": "Inspection incomplete",
            "images_pending": 0,
            "hotspots": 0,
        }
    roll = visit_rollup(visit)
    return roll["visit_status"], roll


def _thermal_image_id(position: Position) -> int | None:
    close = next(
        (
            img
            for img in position.images
            if img.image_type == "TH Close" and (img.thumbnail_path or img.file_path)
        ),
        None,
    )
    if close:
        return close.id
    full = next(
        (
            img
            for img in position.images
            if img.image_type == "TH Full" and (img.thumbnail_path or img.file_path)
        ),
        None,
    )
    return full.id if full else None


def _team_user_ids(db: Session, team: Team) -> list[int]:
    ids = [u.id for u in db.query(User).filter(User.team_id == team.id).all()]
    if team.leader_user_id and team.leader_user_id not in ids:
        ids.append(team.leader_user_id)
    return ids


def _scope_towers(db: Session, team: Team, field_date: dt.date) -> tuple[list[Tower], str, TeamOutingPlan | None]:
    assigned = sorted(
        db.query(Tower).filter(Tower.is_active.is_(True), Tower.assigned_team_id == team.id).all(),
        key=lambda t: natural_sort_key(t.tower_id),
    )
    plan = (
        db.query(TeamOutingPlan)
        .options(joinedload(TeamOutingPlan.towers).joinedload(TeamOutingTower.tower))
        .filter(TeamOutingPlan.team_id == team.id, TeamOutingPlan.field_date == field_date)
        .first()
    )
    if plan and plan.towers:
        order = {row.tower_pk: row.sort_order for row in plan.towers}
        towers = [t for t in assigned if t.id in order]
        towers.sort(key=lambda t: order[t.id])
        return towers, "outing", plan
    return assigned, "assigned", plan


def _night_has_work(db: Session, team_id: int, field_date: dt.date) -> bool:
    plan = (
        db.query(TeamOutingPlan)
        .options(joinedload(TeamOutingPlan.towers))
        .filter(TeamOutingPlan.team_id == team_id, TeamOutingPlan.field_date == field_date)
        .first()
    )
    if plan and (plan.towers or plan.ended_at or plan.handover_note):
        return True
    if (
        db.query(NightTowerClaim.id)
        .filter(NightTowerClaim.team_id == team_id, NightTowerClaim.field_date == field_date)
        .first()
    ):
        return True
    start, end = shift_window(field_date)
    if (
        db.query(Visit.id)
        .filter(
            Visit.team_id == team_id,
            Visit.created_at >= start,
            Visit.created_at < end,
        )
        .first()
    ):
        return True
    if (
        db.query(TeamChannelMessage.id)
        .filter(TeamChannelMessage.team_id == team_id, TeamChannelMessage.field_date == field_date)
        .first()
    ):
        return True
    return False


def previous_unfinished_night(
    db: Session, team: Team, before: dt.date
) -> tuple[dt.date | None, int]:
    """Most recent earlier field night that still has skipped / open / pending towers."""
    for i in range(1, LOOKBACK_NIGHTS + 1):
        day = before - dt.timedelta(days=i)
        if not _night_has_work(db, team.id, day):
            continue
        pack = build_handover_pack(db, team, day, include_previous=False)
        if pack["remaining"] > 0:
            return day, pack["remaining"]
    return None, 0


def _headline(
    team: Team,
    completed: int,
    skipped: int,
    in_progress: int,
    pending: int,
    total: int,
    recommended: dict | None,
    ended_at: dt.datetime | None,
) -> str:
    bits: list[str] = [f"{completed} done"]
    if skipped:
        bits.append(f"{skipped} skipped")
    if in_progress:
        bits.append(f"{in_progress} still open")
    if pending:
        bits.append(f"{pending} not started")
    text = f"{team.name}: {', '.join(bits)} ({total} tonight)."
    if recommended:
        text += f" Start next at {recommended['tower_id']}."
    if ended_at:
        text += " Outing closed."
    return text


def build_handover_pack(
    db: Session,
    team: Team,
    field_date: dt.date | None = None,
    include_previous: bool = True,
) -> dict:
    day = field_date or current_field_date()
    towers, scope, plan = _scope_towers(db, team, day)
    shift_start, shift_end = shift_window(day)

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

    claims = (
        db.query(NightTowerClaim)
        .options(joinedload(NightTowerClaim.assigned_user))
        .filter(NightTowerClaim.team_id == team.id, NightTowerClaim.field_date == day)
        .all()
    )
    claims_by_tower = {c.tower_pk: c for c in claims}

    rows: list[dict] = []
    completed = skipped = in_progress = pending = 0
    remaining_candidates: list[Candidate] = []
    all_points: list[tuple[float, float]] = []
    for t in towers:
        if t.latitude is not None and t.longitude is not None:
            all_points.append((t.latitude, t.longitude))
        visit = latest_visit.get(t.id)
        visit_status, roll = _visit_board_status(visit)
        claim = claims_by_tower.get(t.id)
        status = classify_tower(visit_status, claim.status if claim else None)
        if status == "completed":
            completed += 1
        elif status == "skipped":
            skipped += 1
        elif status == "in_progress":
            in_progress += 1
        else:
            pending += 1
        row = {
            "id": t.id,
            "tower_id": t.tower_id,
            "area": t.area,
            "latitude": t.latitude,
            "longitude": t.longitude,
            "status": status,
            "visit_id": visit.id if visit else (claim.visit_id if claim else None),
            "visit_status": visit_status,
            "images_pending": int(roll.get("images_pending") or 0),
            "hotspots": int(roll.get("hotspots") or 0),
            "claim_status": claim.status if claim else None,
            "skip_reason": claim.skip_reason if claim else None,
            "claimed_by_name": _display_name(claim.assigned_user) if claim else None,
        }
        rows.append(row)
        if (
            status in REMAINING_STATUSES
            and t.latitude is not None
            and t.longitude is not None
        ):
            remaining_candidates.append(
                Candidate(
                    id=t.id,
                    tower_id=t.tower_id,
                    area=t.area,
                    latitude=t.latitude,
                    longitude=t.longitude,
                    status="in_progress" if status == "in_progress" else "pending",
                    visit_id=row["visit_id"],
                )
            )

    user_ids = _team_user_ids(db, team)
    last_gps = None
    origin: tuple[float, float] | None = None
    if user_ids:
        ping = (
            db.query(LocationPing)
            .options(joinedload(LocationPing.user))
            .filter(
                LocationPing.user_id.in_(user_ids),
                LocationPing.recorded_at >= shift_start,
                LocationPing.recorded_at < shift_end,
            )
            .order_by(LocationPing.recorded_at.desc())
            .first()
        )
        if ping:
            last_gps = {
                "latitude": ping.latitude,
                "longitude": ping.longitude,
                "recorded_at": ping.recorded_at,
                "user_name": _display_name(ping.user),
            }
            origin = (ping.latitude, ping.longitude)
    if origin is None:
        done_with_gps = [
            t for t in towers if t.latitude is not None and t.longitude is not None
        ]
        # Prefer the last completed / skipped tower along the list as a stand-in origin.
        for t in reversed(towers):
            st = next((r["status"] for r in rows if r["id"] == t.id), None)
            if st in ("completed", "skipped") and t.latitude is not None and t.longitude is not None:
                origin = (t.latitude, t.longitude)
                break
        if origin is None and done_with_gps:
            origin = (done_with_gps[0].latitude, done_with_gps[0].longitude)

    recommended = None
    if remaining_candidates and origin is not None:
        stops = plan_stops(
            origin,
            remaining_candidates,
            all_points or [(c.latitude, c.longitude) for c in remaining_candidates],
            heading_sign=1.0,
            limit=1,
            dwell_min=25,
        )
        if stops:
            s = stops[0]
            recommended = {
                "id": s["id"],
                "tower_id": s["tower_id"],
                "area": s["area"],
                "latitude": s["latitude"],
                "longitude": s["longitude"],
                "reason": s["reason"],
                "travel_km": s["travel_km"],
                "visit_id": s.get("visit_id"),
            }

    hotspots: list[dict] = []
    for visit in latest_visit.values():
        tower = next((t for t in towers if t.id == visit.tower_id), None)
        if tower is None:
            continue
        for pos in visit.positions:
            if pos.hotspot != "Yes":
                continue
            hotspots.append(
                {
                    "tower_id": tower.tower_id,
                    "tower_pk": tower.id,
                    "visit_id": visit.id,
                    "position_id": pos.id,
                    "position_code": pos.position_code,
                    "ohl": pos.ohl,
                    "phase": pos.phase,
                    "string": pos.string,
                    "tmax_c": pos.tmax_c,
                    "tref_c": pos.tref_c,
                    "delta_t": pos.delta_t,
                    "severity": pos.severity,
                    "image_id": _thermal_image_id(pos),
                }
            )

    events: list[dict] = []
    messages = (
        db.query(TeamChannelMessage)
        .options(joinedload(TeamChannelMessage.author), joinedload(TeamChannelMessage.tower))
        .filter(
            TeamChannelMessage.team_id == team.id,
            TeamChannelMessage.field_date == day,
            TeamChannelMessage.kind.in_(OPS_KINDS),
        )
        .order_by(TeamChannelMessage.created_at.desc())
        .all()
    )
    for msg in messages:
        events.append(
            {
                "id": msg.id,
                "kind": msg.kind,
                "body": msg.body,
                "tower_id": msg.tower.tower_id if msg.tower else None,
                "tower_pk": msg.tower_pk,
                "visit_id": msg.visit_id,
                "created_at": msg.created_at,
                "author_name": _display_name(msg.author),
            }
        )

    notes: list[dict] = []
    log_dates = (day, day + dt.timedelta(days=1))
    logs = (
        db.query(TeamDailyLog)
        .filter(TeamDailyLog.team_id == team.id, TeamDailyLog.log_date.in_(log_dates))
        .order_by(TeamDailyLog.created_at.desc())
        .all()
    )
    author_ids = {log.created_by for log in logs if log.created_by}
    authors = {
        u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()
    } if author_ids else {}
    for log in logs:
        notes.append(
            {
                "id": log.id,
                "note": log.note,
                "has_audio": bool(log.audio_path),
                "transcribed": bool(log.transcribed),
                "created_at": log.created_at,
                "created_by_name": _display_name(authors.get(log.created_by)) if log.created_by else None,
            }
        )

    ended_by_name = None
    if plan and plan.ended_by:
        ended_user = db.get(User, plan.ended_by)
        ended_by_name = _display_name(ended_user)

    previous_field_date = None
    previous_remaining = 0
    if include_previous:
        previous_field_date, previous_remaining = previous_unfinished_night(db, team, day)

    total = len(rows)
    remaining = skipped + in_progress + pending
    unfinished = [r for r in rows if r["status"] == "in_progress" and r["visit_id"]]

    return {
        "team_id": team.id,
        "team_name": team.name,
        "field_date": day,
        "scope": scope,
        "total": total,
        "completed": completed,
        "skipped": skipped,
        "in_progress": in_progress,
        "pending": pending,
        "remaining": remaining,
        "headline": _headline(
            team, completed, skipped, in_progress, pending, total, recommended, plan.ended_at if plan else None
        ),
        "ended_at": plan.ended_at if plan else None,
        "ended_by_name": ended_by_name,
        "handover_note": plan.handover_note if plan else None,
        "last_gps": last_gps,
        "recommended": recommended,
        "previous_field_date": previous_field_date,
        "previous_remaining": previous_remaining,
        "towers": rows,
        "hotspots": hotspots,
        "events": events,
        "notes": notes,
        "unfinished_visits": unfinished,
        "continued_from": None,
    }


def _get_or_create_plan(db: Session, team_id: int, field_date: dt.date, user_id: int | None) -> TeamOutingPlan:
    plan = (
        db.query(TeamOutingPlan)
        .options(joinedload(TeamOutingPlan.towers).joinedload(TeamOutingTower.tower))
        .filter(TeamOutingPlan.team_id == team_id, TeamOutingPlan.field_date == field_date)
        .first()
    )
    if plan is None:
        plan = TeamOutingPlan(team_id=team_id, field_date=field_date, created_by=user_id)
        db.add(plan)
        db.flush()
    return plan


def end_outing(
    db: Session,
    team: Team,
    user: User,
    note: str | None = None,
    field_date: dt.date | None = None,
) -> dict:
    day = field_date or current_field_date()
    plan = _get_or_create_plan(db, team.id, day, user.id)
    plan.ended_at = dt.datetime.utcnow()
    plan.ended_by = user.id
    if note is not None:
        text = note.strip()
        plan.handover_note = text or None
    plan.updated_at = dt.datetime.utcnow()
    db.commit()
    return build_handover_pack(db, team, day)


def remaining_tower_ids(pack: dict) -> list[int]:
    return [t["id"] for t in pack["towers"] if t["status"] in REMAINING_STATUSES]


def continue_last_night(
    db: Session,
    team: Team,
    user: User,
    field_date: dt.date | None = None,
    from_date: dt.date | None = None,
    replace: bool = False,
) -> dict:
    today = field_date or current_field_date()
    if from_date is not None:
        prev = from_date
        prev_pack = build_handover_pack(db, team, prev, include_previous=False)
        leftover = remaining_tower_ids(prev_pack)
        if not leftover:
            raise ValueError("That night's towers are all complete")
    else:
        prev, _n = previous_unfinished_night(db, team, today)
        if prev is None:
            raise ValueError("No previous night to continue")
        prev_pack = build_handover_pack(db, team, prev, include_previous=False)
        leftover = remaining_tower_ids(prev_pack)
        if not leftover:
            raise ValueError("Last night's towers are all complete")

    plan = _get_or_create_plan(db, team.id, today, user.id)
    existing = [row.tower_pk for row in sorted(plan.towers, key=lambda r: r.sort_order)]
    if replace or not existing:
        new_ids = leftover
    else:
        new_ids = leftover + [tid for tid in existing if tid not in leftover]

    db.query(TeamOutingTower).filter(TeamOutingTower.plan_id == plan.id).delete()
    for i, tid in enumerate(new_ids):
        db.add(TeamOutingTower(plan_id=plan.id, tower_pk=tid, sort_order=i))
    plan.ended_at = None
    plan.ended_by = None
    if not (plan.notes or "").strip():
        rec = prev_pack.get("recommended") or {}
        start_at = rec.get("tower_id") or (prev_pack["towers"][0]["tower_id"] if leftover else "")
        plan.notes = f"Continued from {prev.isoformat()}: {len(leftover)} towers remaining. Start at {start_at}."
    if prev_pack.get("handover_note") and not plan.handover_note:
        plan.handover_note = prev_pack["handover_note"]
    plan.updated_at = dt.datetime.utcnow()

    rec = prev_pack.get("recommended") or {}
    start_label = rec.get("tower_id") or ""
    body = f"Continued from {prev.isoformat()}: {len(leftover)} towers remaining."
    if start_label:
        body += f" Start at {start_label}."
    db.add(
        TeamChannelMessage(
            team_id=team.id,
            field_date=today,
            kind="dispatch",
            body=body,
            created_by=user.id,
        )
    )
    db.commit()
    pack = build_handover_pack(db, team, today)
    pack["continued_from"] = prev
    return pack
