"""The OETC-style "field execution plan" — a project mobilization/scheduling document for a
multi-team, multi-day inspection campaign, rendered from backend/app/templates/field_execution_plan.docx
via docxtpl. Unlike the visit/report templates elsewhere in this app, this one is a bundled app asset
(not user-uploaded) — its layout is a close copy of a real customer-approved plan, with the
project-specific numbers turned into {{ }} / {%tr %} / {%tc %} placeholders (see that file's git
history / the build script used to make it for exactly which spots were templatized).

What's genuinely computed here vs. what the admin types in at generation time:
    - Total towers, team headcounts, line-sector breakdown — pulled live from Tower/Team data.
    - The day-by-day schedule — a computed PROJECTION (not a record of real work done): each team
      works its own primary sector (Team.primary_sector) at a flat daily capacity until that sector's
      towers run out, then redirects to whichever *other* sector still has the most towers left,
      until every sector reaches zero; a final reserve/reinspection day is always appended. This is a
      planning estimate for a document handed out *before* fieldwork starts, not the Team Activity
      Report's after-the-fact numbers (see services/team_activity_report.py for that one).
    - Client name/reference letter/prepared-by/period/voltage/region labels, and which towers/teams
      to include — free-form inputs on FieldExecutionPlanRequest, since none of that is modeled
      anywhere else in the app (it's specific to one customer engagement, not inspection data).

Deliberately NOT modeled here (left as fixed boilerplate text in the template itself, unchanged from
the source document): the daily operational routine, equipment checklist, QA/QC control points, the
risk register, KPI targets, and the sign-off block — none of that varies with live app data, it's
standing operating procedure text.
"""
from __future__ import annotations

from app.models import Team, Tower
from app.schemas import FieldExecutionPlanRequest
from sqlalchemy.orm import Session, joinedload

UNCLASSIFIED_SECTOR = "غير مصنف"
MOBILIZATION_LABEL = "معاينة وتجهيز"
RESERVE_LABEL = "احتياط / إعادة فحص"


def _group_towers_by_sector(towers: list[Tower]) -> list[dict]:
    counts: dict[str, int] = {}
    for t in towers:
        name = t.line_sector or UNCLASSIFIED_SECTOR
        counts[name] = counts.get(name, 0) + 1
    # Largest sector first — reads naturally as "here's the biggest piece of work", and it's what
    # the post-completion-action text below means by "the largest sector".
    return [{"name": n, "tower_count": c, "notes": "-"} for n, c in sorted(counts.items(), key=lambda kv: -kv[1])]


def _assign_primary_sectors(teams: list[Team], sector_names: set[str]) -> list[dict]:
    assignment = [
        {"id": t.id, "name": t.name, "member_count": len(t.members), "sector": t.primary_sector if t.primary_sector in sector_names else None}
        for t in teams
    ]
    claimed = {a["sector"] for a in assignment if a["sector"]}
    unclaimed = [n for n in sector_names if n not in claimed]
    # Round-robin any team without an explicit primary_sector onto whatever sectors are still free —
    # keeps every sector covered by *someone* from day one even if the roster wasn't fully configured.
    for a in assignment:
        if a["sector"] is None and unclaimed:
            a["sector"] = unclaimed.pop(0)
    return assignment


def _build_schedule_days(assignment: list[dict], sectors: list[dict], capacity: int) -> list[dict]:
    remaining = {s["name"]: s["tower_count"] for s in sectors}
    total_remaining = sum(remaining.values())
    days = [
        {
            "label": "اليوم 0",
            "cells": [MOBILIZATION_LABEL for _ in assignment],
            "total": "-",
            "status": "Mobilization",
        }
    ]

    max_days = total_remaining // max(capacity, 1) + 5  # generous safety bound, not a target
    day_no = 1
    while total_remaining > 0 and day_no <= max_days:
        cells = []
        day_total = 0
        completed_this_day: list[str] = []
        any_support = False
        for a in assignment:
            own = a["sector"]
            target = own if (own and remaining.get(own, 0) > 0) else None
            if target is None:
                candidates = [(n, c) for n, c in remaining.items() if c > 0]
                if candidates:
                    target = max(candidates, key=lambda kv: kv[1])[0]
                    any_support = True
            elif own and target == own:
                pass
            if target:
                take = min(capacity, remaining[target])
                remaining[target] -= take
                total_remaining -= take
                if remaining[target] == 0:
                    completed_this_day.append(target)
                cells.append(f"{take} برج" if target == own else f"دعم {target}: {take}")
                day_total += take
            else:
                cells.append("-")
        if completed_this_day:
            status = "، ".join(f"إكمال {s}" for s in dict.fromkeys(completed_this_day))
        elif any_support and all((a["sector"] is None or remaining.get(a["sector"], 0) == 0) for a in assignment):
            status = "دعم مشترك"
        else:
            status = "تنفيذ"
        days.append({"label": f"اليوم {day_no}", "cells": cells, "total": str(day_total), "status": status})
        day_no += 1

    days.append(
        {
            "label": f"اليوم {day_no}",
            "cells": [RESERVE_LABEL for _ in assignment],
            "total": "-",
            "status": "إغلاق الفحص",
        }
    )
    return days


def build_field_execution_plan_context(db: Session, payload: FieldExecutionPlanRequest) -> dict:
    towers_q = db.query(Tower).filter(Tower.is_active.is_(True))
    if payload.area:
        towers_q = towers_q.filter(Tower.area == payload.area)
    towers = towers_q.all()
    total_towers = len(towers)

    sectors = _group_towers_by_sector(towers)
    sector_names = {s["name"] for s in sectors}
    sector_by_name = {s["name"]: s for s in sectors}
    largest_sector = sectors[0]["name"] if sectors else None

    teams_q = db.query(Team).options(joinedload(Team.members)).filter(Team.is_active.is_(True))
    if payload.team_ids:
        teams_q = teams_q.filter(Team.id.in_(payload.team_ids))
    team_rows = teams_q.order_by(Team.id).all()

    assignment = _assign_primary_sectors(team_rows, sector_names)
    schedule_days = _build_schedule_days(assignment, sectors, payload.capacity_per_team_per_day)

    teams_ctx = []
    for a in assignment:
        sec = a["sector"]
        if sec:
            qty_label = f"{sector_by_name[sec]['tower_count']} برجًا"
            if sec == largest_sector:
                post = "يستمر كفريق رئيسي للقطاع الأكبر"
            else:
                post = f"ينتقل لدعم {largest_sector} عند الحاجة" if largest_sector else "-"
            label = sec
        else:
            label = "دعم عام"
            qty_label = "-"
            post = f"يدعم {largest_sector} حسب الحاجة" if largest_sector else "-"
        teams_ctx.append(
            {
                "name": a["name"],
                "member_count": a["member_count"],
                "primary_sector_label": label,
                "primary_sector_qty_label": qty_label,
                "post_completion_text": post,
            }
        )

    personnel_count = sum(a["member_count"] for a in assignment)
    team_count = len(assignment)
    avg_team_size = round(personnel_count / team_count) if team_count else 0
    plan_days_count = len(schedule_days)
    working_days_count = max(plan_days_count - 1, 0)

    return {
        "client_name": payload.client_name,
        "client_short": payload.client_short,
        "reference_no": payload.reference_no,
        "reference_date": payload.reference_date,
        "prepared_by": payload.prepared_by,
        "prepared_by_upper": payload.prepared_by.upper(),
        "period_label": payload.period_label,
        "voltage_label": payload.voltage_label,
        "region_label": payload.region_label,
        "total_towers": total_towers,
        "team_count": team_count,
        "personnel_count": personnel_count,
        "avg_team_size": avg_team_size,
        "plan_days_count": plan_days_count,
        "working_days_count": working_days_count,
        "sectors": sectors,
        "teams": teams_ctx,
        "schedule_days": schedule_days,
    }


def render_field_execution_plan_docx(db: Session, payload: FieldExecutionPlanRequest) -> bytes:
    import io

    from docxtpl import DocxTemplate
    from jinja2 import Environment

    from app.config import BASE_DIR

    template_path = BASE_DIR / "app" / "templates" / "field_execution_plan.docx"
    tpl = DocxTemplate(str(template_path))
    context = build_field_execution_plan_context(db, payload)
    jinja_env = Environment(finalize=lambda v: "" if v is None else v)
    tpl.render(context, jinja_env=jinja_env)
    buf = io.BytesIO()
    tpl.save(buf)
    return buf.getvalue()
