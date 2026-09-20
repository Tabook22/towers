from __future__ import annotations

import datetime as dt
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import check_visit_team_access, get_current_user, has_permission_level, require_permission_level
from app.models import Area, LineInspectionReport, Position, ReportTemplate, Team, Tower, User, UserRole, Visit, utcnow
from app.schemas import (
    FieldExecutionPlanRequest,
    LineInspectionReportOut,
    LineInspectionReportRequest,
    OetcAreaReportRequest,
    OetcConsolidatedReportRequest,
    OetcReportPreview,
)
from app.services.docx_reports import render_visit_report_docx
from app.services.field_execution_plan import render_field_execution_plan_docx
from app.services.oetc_grouped_report import (
    _visits_for_area,
    plan_area_report,
    plan_consolidated_report,
    plan_report_numbers,
    render_area_report,
    render_consolidated_report,
)
from app.services.oetc_report import render_oetc_line_report_docx
from app.services.pdf_form_reports import render_visit_report_pdf_form
from app.services.reports import build_overall_report, build_visit_report
from app.services.rollup import visit_rollup
from app.services.team_activity_report import (
    _position_has_activity,
    build_team_activity_tree,
    build_team_activity_workbook,
    query_team_activity_visits,
)
from app.utils import natural_sort_key

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _save_report_file(report_number: str, generated_at: dt.datetime, docx_bytes: bytes) -> str:
    """Archives a generated report's actual bytes under settings.reports_dir (the "special folder"
    every report also needs to land in, alongside its LineInspectionReport row) so a later download
    serves back the exact file that was produced — never a live regeneration that can drift or
    fail if the underlying Position/Visit data changes afterward. Filed under year/month so the
    folder itself stays browsable the same way the Reports Library sorts (see
    oetc_line_report_history) — returns a path relative to reports_dir, stored on the row."""
    safe_number = re.sub(r"[^A-Za-z0-9._-]+", "-", report_number).strip("-") or "report"
    subdir = settings.reports_dir / f"{generated_at.year:04d}" / f"{generated_at.month:02d}"
    subdir.mkdir(parents=True, exist_ok=True)
    filename = f"{safe_number}.docx"
    if (subdir / filename).exists():
        filename = f"{safe_number}-{uuid.uuid4().hex[:8]}.docx"
    (subdir / filename).write_bytes(docx_bytes)
    return f"{generated_at.year:04d}/{generated_at.month:02d}/{filename}"


def _resolve_tower_team(db: Session, tower: Tower, start_date: dt.date, end_date: dt.date) -> int | None:
    """Which team a "by tower" report/preview should use when the caller didn't say — the tower's
    current catalog assignment (Tower.assigned_team_id) is only a hint, never a hard requirement,
    because a tower can be reassigned to another team, or unassigned entirely, after the inspection
    that should still be reportable actually happened. Falls back to whichever team's visit on this
    tower in the date range is most recent; only reports "no team" when neither the catalog nor any
    visit in range has one."""
    visit_teams = (
        db.query(Visit.team_id, Visit.inspection_date)
        .filter(
            Visit.tower_id == tower.id,
            Visit.team_id.isnot(None),
            Visit.inspection_date.isnot(None),
            Visit.inspection_date >= start_date,
            Visit.inspection_date <= end_date,
        )
        .order_by(Visit.inspection_date.desc(), Visit.id.desc())
        .all()
    )
    distinct_teams = {team_id for team_id, _ in visit_teams}
    if not distinct_teams:
        return tower.assigned_team_id
    if tower.assigned_team_id in distinct_teams:
        return tower.assigned_team_id
    return visit_teams[0][0]  # most recent visit's team


def _load_visit(db: Session, visit_id: int) -> Visit:
    visit = (
        db.query(Visit)
        .options(joinedload(Visit.positions).joinedload(Position.images), joinedload(Visit.tower))
        .filter(Visit.id == visit_id)
        .first()
    )
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    return visit


def _active_template_path(db: Session, kind: str):
    template = (
        db.query(ReportTemplate)
        .filter(ReportTemplate.is_active.is_(True), ReportTemplate.kind == kind)
        .order_by(ReportTemplate.id.desc())
        .first()
    )
    if not template:
        kind_label = "Word (.docx)" if kind == "docx" else "fillable PDF"
        raise HTTPException(
            status_code=404,
            detail=f"No {kind_label} report template uploaded yet — upload one on the Reports page first.",
        )
    template_path = settings.report_templates_dir / template.file_path
    if not template_path.exists():
        raise HTTPException(status_code=404, detail="The active report template's file is missing from storage")
    return template_path


@router.get("/visits/{visit_id}.pdf")
def visit_report(visit_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit = _load_visit(db, visit_id)
    check_visit_team_access(visit, user)
    pdf_bytes = build_visit_report(visit, db)
    filename = f"{visit.tower.tower_id.replace(' ', '')}-visit-{visit.id}-report.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/visits/{visit_id}.docx")
def visit_report_docx(visit_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The custom-branded Word version — only available once someone has uploaded a .docx template
    (see routers/report_templates.py); the fixed-layout PDF above always works regardless."""
    visit = _load_visit(db, visit_id)
    check_visit_team_access(visit, user)
    template_path = _active_template_path(db, "docx")
    docx_bytes = render_visit_report_docx(visit, template_path)
    filename = f"{visit.tower.tower_id.replace(' ', '')}-visit-{visit.id}-report.docx"
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/visits/{visit_id}/custom.pdf")
def visit_report_custom_pdf(visit_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The custom-branded PDF version, filled into an uploaded fillable PDF *form* template — only
    available once someone has uploaded one (see routers/report_templates.py); `.pdf` above (the
    fixed built-in layout) always works regardless and isn't affected by this at all."""
    visit = _load_visit(db, visit_id)
    check_visit_team_access(visit, user)
    template_path = _active_template_path(db, "pdf")
    pdf_bytes = render_visit_report_pdf_form(visit, template_path)
    filename = f"{visit.tower.tower_id.replace(' ', '')}-visit-{visit.id}-report.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/overall.pdf")
def overall_report(area: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value):
        raise HTTPException(status_code=403, detail="Not available for team-leader/team-member accounts — see your mission list instead")
    q = db.query(Tower).filter(Tower.is_active.is_(True))
    if area:
        q = q.filter(Tower.area == area)
    towers = sorted(q.all(), key=lambda t: natural_sort_key(t.tower_id))

    rows = []
    for tower in towers:
        latest = (
            db.query(Visit)
            .options(joinedload(Visit.positions).joinedload(Position.images))
            .filter(Visit.tower_id == tower.id)
            .order_by(Visit.inspection_date.desc().nullslast(), Visit.id.desc())
            .first()
        )
        if not latest:
            continue
        r = visit_rollup(latest)
        rows.append({"tower_id": tower.tower_id, "area": tower.area, **r})

    pdf_bytes = build_overall_report(rows, area, db)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="overall-summary-report.pdf"'},
    )


@router.get("/team-activity")
def team_activity_report(
    team_id: int | None = None,
    start_date: dt.date | None = None,
    end_date: dt.date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The full-detail team/day/tower/position/image breakdown — what every team did, day by day,
    tower by tower. A team_leader always gets just their own team (team_id is ignored for them, same
    as everywhere else this pattern is used); admin/reviewer can filter by team_id or leave it off
    for every team at once."""
    visits = query_team_activity_visits(db, user, team_id=team_id, start_date=start_date, end_date=end_date)
    return build_team_activity_tree(visits)


@router.get("/team-activity.xlsx")
def team_activity_report_xlsx(
    team_id: int | None = None,
    start_date: dt.date | None = None,
    end_date: dt.date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Same data as GET /team-activity, flattened into one filterable/sortable Excel sheet — one row
    per evidence image (or one row per position, if it has none yet), each carrying its full
    Team/Day/Tower/Position context so Excel's own sort/filter/pivot keep working."""
    visits = query_team_activity_visits(db, user, team_id=team_id, start_date=start_date, end_date=end_date)
    tree = build_team_activity_tree(visits)
    xlsx_bytes = build_team_activity_workbook(tree)
    stamp = dt.date.today().isoformat()
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="team-activity-{stamp}.xlsx"'},
    )


@router.post("/field-execution-plan.docx")
def field_execution_plan_report(
    payload: FieldExecutionPlanRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission_level("generate_reports", "add", UserRole.REVIEWER.value)),
):
    """The customer-facing mobilization/execution plan document — client info, live tower/team
    counts, a computed day-by-day schedule projection. See services/field_execution_plan.py for what
    each field drives; admin/reviewer only, since this is a project-planning deliverable, not
    day-to-day field data."""
    docx_bytes = render_field_execution_plan_docx(db, payload)
    stamp = dt.date.today().isoformat()
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="field-execution-plan-{stamp}.docx"'},
    )


@router.get("/oetc-preview", response_model=OetcReportPreview)
def oetc_report_preview(
    start_date: dt.date,
    end_date: dt.date,
    team_id: int | None = None,
    tower_id: int | None = None,
    area: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """A live "what will this include" check for the official report form — same scope params as
    the generate endpoints below (tower_id alone resolves its team the same way; area covers every
    team on that line; neither given means the whole project, matching the consolidated report's
    own scope), but read-only and no rendering, so the admin sees real numbers the moment a scope
    and date range are picked instead of only after clicking Generate. Counts positions the exact
    same way the real report does (_position_has_activity) so these numbers never drift from what
    generating actually produces."""
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")

    visits: list[Visit] = []
    if area:
        visits = _visits_for_area(db, area, start_date, end_date)
    elif tower_id is not None or team_id is not None:
        tower = db.get(Tower, tower_id) if tower_id is not None else None
        resolved_team_id = team_id
        if resolved_team_id is None and tower is not None:
            resolved_team_id = _resolve_tower_team(db, tower, start_date, end_date)
        if resolved_team_id is not None:
            q = db.query(Visit).options(
                joinedload(Visit.positions).joinedload(Position.images)
            ).filter(
                Visit.team_id == resolved_team_id,
                Visit.inspection_date.isnot(None),
                Visit.inspection_date >= start_date,
                Visit.inspection_date <= end_date,
            )
            if tower is not None:
                q = q.filter(Visit.tower_id == tower.id)
            visits = q.all()
    else:
        for a in db.query(Area).order_by(Area.name).all():
            visits.extend(_visits_for_area(db, a.name, start_date, end_date))

    if user.role == UserRole.TEAM_LEADER.value:
        visits = [v for v in visits if v.team_id == user.team_id]

    team_ids = {v.team_id for v in visits if v.team_id is not None}
    tower_ids = {v.tower_id for v in visits}
    position_count = 0
    hotspot_count = 0
    for v in visits:
        for pos in v.positions:
            if not _position_has_activity(pos):
                continue
            position_count += 1
            if pos.hotspot == "Yes":
                hotspot_count += 1

    ok = len(visits) > 0
    return OetcReportPreview(
        ok=ok,
        team_count=len(team_ids),
        tower_count=len(tower_ids),
        visit_count=len(visits),
        position_count=position_count,
        hotspot_count=hotspot_count,
        message=None if ok else "No visits found for this scope in that date range",
    )


@router.post("/oetc-line-report.docx")
def oetc_line_report(
    payload: LineInspectionReportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The official customer-format report (see services/oetc_report.py) — a team's whole line
    campaign over a date range by default, or (when payload.tower_id is set) just that one
    particular tower's visits, rendered straight into the customer's own template either way.
    "Report by tower" gives tower_id alone (team_id left unset) — resolved below via
    _resolve_tower_team, so the caller only needs to know the tower, not which team owns it, and a
    tower that was reassigned or unassigned after the inspection still resolves to whichever team
    actually did the work. Admin/reviewer can generate for any team; a team_leader only for their
    own, same boundary as every other team-scoped report in this app; a team_member (whose whole
    workspace is their own assigned missions, not team-wide reporting) is refused outright."""
    tower = None
    if payload.tower_id is not None:
        tower = db.get(Tower, payload.tower_id)
        if not tower:
            raise HTTPException(status_code=404, detail="Tower not found")

    team_id = payload.team_id
    if team_id is None:
        if tower is None:
            raise HTTPException(status_code=400, detail="team_id or tower_id is required")
        team_id = _resolve_tower_team(db, tower, payload.start_date, payload.end_date)
        if team_id is None:
            raise HTTPException(
                status_code=400,
                detail=f"{tower.tower_id} isn't assigned to a team, and no visit in that date range has one either",
            )

    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    if user.role == UserRole.TEAM_LEADER.value and user.team_id != team_id:
        raise HTTPException(status_code=403, detail="You don't have access to this team")
    if user.role == UserRole.ADMIN.value and not has_permission_level(user, "generate_reports", "add"):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if db.query(LineInspectionReport).filter(LineInspectionReport.report_number == payload.report_number).first():
        raise HTTPException(status_code=400, detail=f"Report number '{payload.report_number}' already used")

    visits_query = db.query(Visit).options(
        joinedload(Visit.positions).joinedload(Position.images), joinedload(Visit.tower)
    ).filter(
        Visit.team_id == team.id,
        Visit.inspection_date >= payload.start_date,
        Visit.inspection_date <= payload.end_date,
    )
    if tower is not None:
        visits_query = visits_query.filter(Visit.tower_id == tower.id)
    visits = visits_query.all()
    if not visits:
        scope = f"tower {tower.tower_id}" if tower else "this team"
        raise HTTPException(status_code=400, detail=f"No visits found for {scope} in that date range")

    docx_bytes = render_oetc_line_report_docx(team, visits, payload, tower=tower)

    generated_at = utcnow()
    record = LineInspectionReport(
        team_id=team.id,
        tower_id=tower.id if tower else None,
        start_date=payload.start_date,
        end_date=payload.end_date,
        report_number=payload.report_number,
        overall_condition=payload.overall_condition,
        probable_cause=payload.probable_cause,
        corrective_action=payload.corrective_action,
        additional_comments=payload.additional_comments,
        prepared_by=payload.prepared_by,
        reviewed_by=payload.reviewed_by,
        approved_by=payload.approved_by,
        approval_date=payload.approval_date,
        created_by=user.id,
        created_at=generated_at,
        line_sector=tower.line_sector if tower else None,
        file_path=_save_report_file(payload.report_number, generated_at, docx_bytes),
    )
    db.add(record)
    db.commit()

    safe_number = payload.report_number.replace("/", "-")
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_number}.docx"'},
    )


def _persist_blocks(db: Session, blocks, user: User, payload) -> None:
    """One LineInspectionReport row per team-section in a grouped report — same traceability the
    single-team endpoint above gives, just one row per section instead of one for the whole file.
    The sign-off/condition fields are shared across every section of one grouped report (there's
    only one set of them on the request), so each row gets the same copy — needed so re-downloading
    any one section later reproduces it exactly, not just with the team/dates/number right."""
    for b in blocks:
        dates = [v.inspection_date for v in b.visits if v.inspection_date]
        db.add(
            LineInspectionReport(
                team_id=b.team.id,
                start_date=min(dates) if dates else dt.date.today(),
                end_date=max(dates) if dates else dt.date.today(),
                report_number=b.report_number,
                overall_condition=payload.overall_condition,
                probable_cause=payload.probable_cause,
                corrective_action=payload.corrective_action,
                additional_comments=payload.additional_comments,
                prepared_by=payload.prepared_by,
                reviewed_by=payload.reviewed_by,
                approved_by=payload.approved_by,
                approval_date=payload.approval_date,
                created_by=user.id,
            )
        )
    db.commit()


@router.post("/oetc-area-report.docx")
def oetc_area_report(
    payload: OetcAreaReportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission_level("generate_reports", "add", UserRole.REVIEWER.value)),
):
    """One .docx covering every team currently working `payload.area` — each team's own campaign
    rendered in the exact same official template as /oetc-line-report.docx, concatenated together
    (page break between) in Team order. "By area, by team, by mission" — mission order is already
    handled per team-section, same as the single-team report."""
    if not db.query(Area).filter(Area.name == payload.area).first():
        raise HTTPException(status_code=404, detail=f"Unknown area '{payload.area}'")

    plan = plan_area_report(db, payload)
    if not plan:
        raise HTTPException(status_code=400, detail=f"No visits found in '{payload.area}' for that date range")

    numbers = plan_report_numbers(plan, payload.report_number)
    dupes = [n for n in numbers if db.query(LineInspectionReport).filter(LineInspectionReport.report_number == n).first()]
    if dupes:
        raise HTTPException(
            status_code=400,
            detail=f"Report number '{payload.report_number}' is already used for this area/date range — pick a different base number",
        )

    docx_bytes, blocks = render_area_report(db, payload)
    _persist_blocks(db, blocks, user, payload)

    safe_number = payload.report_number.replace("/", "-")
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_number}-{payload.area.replace(" ", "-")}.docx"'},
    )


@router.post("/oetc-consolidated-report.docx")
def oetc_consolidated_report(
    payload: OetcConsolidatedReportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission_level("generate_reports", "add", UserRole.REVIEWER.value)),
):
    """The fully "collected" report — every area in the catalog, and within each area every team
    that worked it in the date range, all in one .docx: Area, then Team, then (per section) Mission.
    Can run long — this is meant as the one master document for the whole program's campaign, not a
    quick read."""
    plan = plan_consolidated_report(db, payload)
    if not plan:
        raise HTTPException(status_code=400, detail="No visits found anywhere in that date range")

    numbers = plan_report_numbers(plan, payload.report_number)
    dupes = [n for n in numbers if db.query(LineInspectionReport).filter(LineInspectionReport.report_number == n).first()]
    if dupes:
        raise HTTPException(
            status_code=400,
            detail=f"Report number '{payload.report_number}' is already used for that date range — pick a different base number",
        )

    docx_bytes, blocks = render_consolidated_report(db, payload)
    _persist_blocks(db, blocks, user, payload)

    safe_number = payload.report_number.replace("/", "-")
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_number}-consolidated.docx"'},
    )


@router.get("/oetc-line-report/history", response_model=list[LineInspectionReportOut])
def oetc_line_report_history(
    team_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Past generated reports — for tracing/reprinting; see LineInspectionReport for what's kept."""
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    q = db.query(LineInspectionReport).options(
        joinedload(LineInspectionReport.team), joinedload(LineInspectionReport.tower)
    )
    if user.role == UserRole.TEAM_LEADER.value:
        q = q.filter(LineInspectionReport.team_id == user.team_id) if user.team_id else q.filter(False)
    elif team_id:
        q = q.filter(LineInspectionReport.team_id == team_id)
    rows = q.order_by(LineInspectionReport.created_at.desc()).all()
    out = []
    for r in rows:
        item = LineInspectionReportOut.model_validate(r)
        item.team_name = r.team.name if r.team else None
        item.tower_name = r.tower.tower_id if r.tower else None
        item.has_file = bool(r.file_path)
        out.append(item)
    return out


@router.get("/oetc-line-report/{report_id}/file")
def download_saved_oetc_report(
    report_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Serves back the exact .docx archived at generation time (see _save_report_file) — the
    Reports Library's primary download path. Only ever set for a report generated after the
    file_path column existed; an older row (or the frontend, when has_file is false) falls back to
    /redownload's live regeneration instead."""
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found")
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    if user.role == UserRole.TEAM_LEADER.value and user.team_id != record.team_id:
        raise HTTPException(status_code=403, detail="You don't have access to this team")
    if not record.file_path:
        raise HTTPException(status_code=404, detail="No saved file for this report — use redownload instead")
    path = settings.reports_dir / record.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Saved file missing from disk — use redownload instead")
    safe_number = record.report_number.replace("/", "-")
    return FileResponse(
        path,
        filename=f"{safe_number}.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.get("/oetc-line-report/{report_id}/redownload")
def redownload_oetc_line_report(
    report_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Re-renders a past report exactly as it was, from the LineInspectionReport row's own saved
    scope/dates/sign-off — no new row is created (unlike the generate endpoints above), so this
    never trips the report-number-uniqueness check and can be called as often as needed. For a row
    that came from a grouped (area/consolidated) report, this reproduces just that one team's
    section, in the same template, since that's the unit a LineInspectionReport row actually
    represents — not the original combined multi-team file."""
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found")
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    if user.role == UserRole.TEAM_LEADER.value and user.team_id != record.team_id:
        raise HTTPException(status_code=403, detail="You don't have access to this team")

    team = db.get(Team, record.team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    tower = db.get(Tower, record.tower_id) if record.tower_id else None

    visits_query = db.query(Visit).options(
        joinedload(Visit.positions).joinedload(Position.images), joinedload(Visit.tower)
    ).filter(
        Visit.team_id == team.id,
        Visit.inspection_date >= record.start_date,
        Visit.inspection_date <= record.end_date,
    )
    if tower is not None:
        visits_query = visits_query.filter(Visit.tower_id == tower.id)
    visits = visits_query.all()
    if not visits:
        raise HTTPException(
            status_code=400,
            detail="No visits found for this report's original scope anymore — the underlying data may have changed since it was generated",
        )

    payload = LineInspectionReportRequest(
        team_id=team.id,
        tower_id=tower.id if tower else None,
        start_date=record.start_date,
        end_date=record.end_date,
        report_number=record.report_number,
        overall_condition=record.overall_condition,
        probable_cause=record.probable_cause,
        corrective_action=record.corrective_action,
        additional_comments=record.additional_comments,
        prepared_by=record.prepared_by,
        reviewed_by=record.reviewed_by,
        approved_by=record.approved_by,
        approval_date=record.approval_date,
    )
    docx_bytes = render_oetc_line_report_docx(team, visits, payload, tower=tower)

    safe_number = record.report_number.replace("/", "-")
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_number}.docx"'},
    )
