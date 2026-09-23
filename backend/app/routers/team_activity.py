"""Daily mission, inspection and saved-report coverage, without assignment-based guesses."""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload, joinedload

from app.database import get_db
from app.config import settings
from app.deps import effective_team_id, require_menu_item
from app.models import (Team, TeamOutingPlan, TeamOutingTower, Visit, Position,
                        NightTowerClaim, LineInspectionReport, ReportImage, User)
from app.services.movement import current_field_date
from app.utils import natural_sort_key

router = APIRouter(prefix="/api/team-activity", tags=["teams"])


@router.get("")
def activity(start_date: dt.date | None = None, end_date: dt.date | None = None,
             team_id: int | None = None, db: Session = Depends(get_db),
             user: User = Depends(require_menu_item("teams"))):
    if user.role not in ("admin", "reviewer", "team_leader", "team_member"):
        raise HTTPException(403, "Team activity is only available to field staff")
    end = end_date or current_field_date()
    start = start_date or end.replace(day=1)
    if start > end or (end - start).days > 366:
        raise HTTPException(422, "Choose a date range of at most 367 days, with the end after the start")
    teams_q = db.query(Team)
    if user.role in ("team_leader", "team_member"):
        own_team = effective_team_id(db, user)
        if team_id is not None and team_id != own_team:
            raise HTTPException(403, "You don't have access to this team")
        teams_q = teams_q.filter(Team.id == own_team) if own_team else teams_q.filter(False)
    if team_id is not None:
        teams_q = teams_q.filter(Team.id == team_id)
    teams = teams_q.order_by(Team.name).all()
    ids = [t.id for t in teams]
    days = {}

    def day(tid, date):
        return days.setdefault((tid, date), {"date": date.isoformat(), "mission_name": None,
            "has_mission": False, "mission_ended": False, "towers": {}})

    def tower(tid, date, pk, name):
        return day(tid, date)["towers"].setdefault(pk, {
            "id": pk, "name": name, "planned": False, "visited": False,
            "recorded": False, "finished": False, "visit_ids": [], "reports": {}})

    plans = db.query(TeamOutingPlan).options(
        selectinload(TeamOutingPlan.towers).joinedload(TeamOutingTower.tower)
    ).filter(TeamOutingPlan.team_id.in_(ids), TeamOutingPlan.field_date >= start,
             TeamOutingPlan.field_date <= end).all()
    for p in plans:
        d = day(p.team_id, p.field_date)
        d.update(has_mission=True, mission_name=p.name, mission_ended=bool(p.ended_at))
        for item in p.towers:
            if item.tower:
                tower(p.team_id, p.field_date, item.tower_pk, item.tower.tower_id)["planned"] = True

    visits = db.query(Visit).options(joinedload(Visit.tower), selectinload(Visit.photos),
        selectinload(Visit.positions).selectinload(Position.images)
    ).filter(Visit.team_id.in_(ids), Visit.inspection_date >= start, Visit.inspection_date <= end).all()
    for v in visits:
        row = tower(v.team_id, v.inspection_date, v.tower_id, v.tower.tower_id)
        row["recorded"] = True
        row["visit_ids"].append(v.id)
        finished = v.mission_status == "completed" or v.status == "closed"
        evidence = bool(v.photos) or any(p.screening_result not in (None, "Not inspected")
            or any(i.file_path for i in p.images) for p in v.positions)
        row["visited"] |= finished or v.mission_status == "in_progress" or evidence
        row["finished"] |= finished

    claims = db.query(NightTowerClaim).options(joinedload(NightTowerClaim.tower)).filter(
        NightTowerClaim.team_id.in_(ids), NightTowerClaim.field_date >= start,
        NightTowerClaim.field_date <= end).all()
    for c in claims:
        if c.status not in ("on_site", "done") and not c.arrived_at:
            continue
        row = tower(c.team_id, c.field_date, c.tower_pk, c.tower.tower_id)
        row["visited"] = True
        row["finished"] |= c.status == "done"

    reports = db.query(LineInspectionReport).options(joinedload(LineInspectionReport.tower),
        selectinload(LineInspectionReport.images).joinedload(ReportImage.position).joinedload(Position.visit).joinedload(Visit.tower)
    ).filter(LineInspectionReport.team_id.in_(ids), LineInspectionReport.end_date >= start,
             LineInspectionReport.start_date <= end).all()
    by_team = {tid: {"reports": [], "report_towers": {}, "undated_report_towers": {}, "unknown_scope_reports": 0} for tid in ids}
    for r in reports:
        info = {"id": r.id, "number": r.report_number, "start_date": r.start_date.isoformat(),
                "end_date": r.end_date.isoformat(),
                "has_file": bool(r.file_path and (settings.reports_dir / r.file_path).is_file())}
        linked = [i.position.visit for i in r.images if i.position and i.position.visit]
        scope = r.scope_towers
        if scope is None:
            scope = ([{"id": r.tower_id, "name": r.tower.tower_id}] if r.tower else
                     list({v.tower_id: {"id": v.tower_id, "name": v.tower.tower_id} for v in linked}.values()))
        bucket = by_team[r.team_id]
        bucket["reports"].append(info)
        if not scope:
            bucket["unknown_scope_reports"] += 1
        for s in scope:
            # New reports freeze visit dates even if inspection records are edited later.
            # Old multi-day reports without dated evidence remain explicitly unattributed.
            dates = {x.get("inspection_date") for x in s.get("visits", []) if x.get("inspection_date")}
            if "visits" not in s:
                dates = {v.inspection_date.isoformat() for v in linked
                         if v.tower_id == s["id"] and v.inspection_date}
                if r.start_date == r.end_date:
                    dates.add(r.start_date.isoformat())
            matching = [dt.date.fromisoformat(d) for d in dates if start.isoformat() <= d <= end.isoformat()]
            if dates and not matching:
                continue
            report_tower = bucket["report_towers"].setdefault(s["id"], {"id": s["id"], "name": s["name"], "reports": {}})
            report_tower["reports"][r.id] = info
            if not dates:
                bucket["undated_report_towers"][s["id"]] = True
            for date in matching:
                tower(r.team_id, date, s["id"], s["name"])["reports"][r.id] = info

    result = []
    for t in teams:
        daily = []
        unique = {k: set() for k in ("planned", "visited", "recorded", "finished", "reported")}
        for (tid, _), d in sorted(days.items(), key=lambda item: item[0][1], reverse=True):
            if tid != t.id:
                continue
            rows = sorted(d["towers"].values(), key=lambda row: natural_sort_key(row["name"]))
            for row in rows:
                row["reports"] = list(row["reports"].values())
                row["reported"] = bool(row["reports"])
                for key in unique:
                    if row[key]:
                        unique[key].add(row["id"])
            d["towers"] = rows
            d["counts"] = {k: sum(bool(row[k]) for row in rows) for k in unique}
            daily.append(d)
        bucket = by_team[t.id]
        report_towers = sorted(bucket["report_towers"].values(), key=lambda row: natural_sort_key(row["name"]))
        for row in report_towers:
            row["reports"] = list(row["reports"].values())
        result.append({"id": t.id, "name": t.name, "is_active": t.is_active, "days": daily,
            "mission_count": sum(d["has_mission"] for d in daily),
            "counts": {**{k: len(v) for k, v in unique.items()}, "reported": len(report_towers)},
            "report_towers": report_towers, "reports": bucket["reports"],
            "undated_report_towers": len(bucket["undated_report_towers"]),
            "unknown_scope_reports": bucket["unknown_scope_reports"]})
    return {"start_date": start, "end_date": end, "teams": result}
