from __future__ import annotations

import datetime as dt
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import settings
from app.database import get_db
from app.deps import check_visit_team_access, get_current_user, has_permission_level, require_permission_level
from app.models import (
    Area,
    Image,
    LineInspectionReport,
    Position,
    ReportComment,
    ReportImage,
    ReportTemplate,
    Team,
    Tower,
    User,
    UserRole,
    Visit,
    utcnow,
)
from app.schemas import (
    FieldExecutionPlanRequest,
    LineInspectionReportOut,
    LineInspectionReportRequest,
    LineInspectionReportUpdate,
    OetcAreaReportRequest,
    OetcConsolidatedReportRequest,
    OetcReportPreview,
    ReportCommentCreate,
    ReportCommentOut,
    ReportImageOut,
    ReportTowerScope,
)
from app.services.docx_reports import render_visit_report_docx
from app.services.field_execution_plan import render_field_execution_plan_docx
from app.services.oetc_grouped_report import (
    _visits_for_area,
    plan_area_report,
    plan_consolidated_report,
    render_area_report,
    render_consolidated_report,
)
from app.services.oetc_report import generate_report_number, render_oetc_line_report_docx, used_image_ids
from app.services.pdf_form_reports import render_visit_report_pdf_form
from app.services.reports import build_overall_report, build_visit_report
from app.services.report_snapshot import capture_inspection_snapshot, snapshot_image_status
from app.services.inspection_data_pdf import build_inspection_data_pdf
from app.services.report_images import selected_images
from app.services.rollup import visit_rollup
from app.services.team_activity_report import (
    _position_has_activity,
    build_team_activity_tree,
    build_team_activity_workbook,
    query_team_activity_visits,
)
from app.utils import natural_sort_key

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _check_report_access(record: LineInspectionReport, user: User) -> None:
    """Who may view a given report (and by extension its images/comments) — a team_member's whole
    workspace is their own assigned missions, not team-wide reporting, so they're refused outright;
    a team_leader only their own team's reports; customers only explicitly shared reports.
    Staff access is unchanged."""
    if user.role == UserRole.CLIENT.value and record.id not in (user.allowed_report_ids or []):
        raise HTTPException(status_code=403, detail="This report has not been shared with your account")
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    if user.role == UserRole.TEAM_LEADER.value and (user.team_id != record.team_id or record.report_type in ('line', 'project')):
        raise HTTPException(status_code=403, detail="You don't have access to this team")


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


def _persist_report_images(db: Session, report_id: int, visits: list[Visit]) -> None:
    """Snapshots exactly which images this report's rendering actually embedded (see
    services.oetc_report.used_image_ids) as ReportImage rows — the client portal's permanent
    report-to-image link. Call after the LineInspectionReport row has an id (flush or commit)."""
    for position_id, image_id, image_type in used_image_ids(visits):
        db.add(ReportImage(report_id=report_id, position_id=position_id, image_id=image_id, image_type=image_type))


def _report_tower_scope(visits: list[Visit]) -> list[dict]:
    towers = {v.tower.id: v.tower.tower_id for v in visits}
    return [{"id": pk, "name": name, "visits": [
        {"id": v.id, "inspection_date": v.inspection_date.isoformat() if v.inspection_date else None}
        for v in visits if v.tower_id == pk
    ]} for pk, name in sorted(towers.items(), key=lambda t: natural_sort_key(t[1]))]


def _saved_scope_line(scope: list[dict], lines: list[str]) -> str | None:
    """Recover legacy grouped-section labels only from unambiguous saved tower names.

    Never infer report membership from today's assignments or silently label a mixed scope.
    """
    matches = [{line for line in lines if tower.get('name', '').startswith(f'{line}-')} for tower in scope]
    if not matches or any(len(match) != 1 for match in matches):
        return None
    names = set.union(*matches)
    return next(iter(names)) if len(names) == 1 else None


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
    uninspected_count = 0
    without_evidence_count = 0
    for v in visits:
        for pos in v.positions:
            if not _position_has_activity(pos):
                continue
            position_count += 1
            if pos.screening_result in (None, 'Not inspected'):
                uninspected_count += 1
            if not selected_images(pos):
                without_evidence_count += 1
            if pos.hotspot == "Yes" or pos.screening_result == "Hotspot detected":
                hotspot_count += 1

    ok = position_count > 0
    return OetcReportPreview(
        ok=ok,
        team_count=len(team_ids),
        tower_count=len(tower_ids),
        visit_count=len(visits),
        position_count=position_count,
        hotspot_count=hotspot_count,
        message=None if ok else ("Visits exist, but no reportable position observations were recorded" if visits else "No visits found for this scope in that date range"),
        draft_visit_count=sum(v.status != 'closed' for v in visits),
        uninspected_position_count=uninspected_count,
        without_selected_evidence_count=without_evidence_count,
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

    if user.role in (UserRole.TEAM_MEMBER.value, UserRole.CLIENT.value):
        raise HTTPException(status_code=403, detail="Not available for this account")
    if user.role == UserRole.TEAM_LEADER.value and user.team_id != team_id:
        raise HTTPException(status_code=403, detail="You don't have access to this team")
    if user.role == UserRole.ADMIN.value and not has_permission_level(user, "generate_reports", "add"):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    generated_at = utcnow()
    if payload.report_number:
        if db.query(LineInspectionReport).filter(LineInspectionReport.report_number == payload.report_number).first():
            raise HTTPException(status_code=400, detail=f"Report number '{payload.report_number}' already used")
    else:
        payload.report_number = generate_report_number(db, team.name, generated_at)

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

    from app.services import report_progress
    report_progress.plan([visits])
    docx_bytes = render_oetc_line_report_docx(team, visits, payload, tower=tower)
    report_progress.advance()  # Single-section document needs no merge.
    report_progress.stage('Saving report to library')

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
        report_type="tower" if tower else "team",
        scope_towers=_report_tower_scope(visits),
        inspection_snapshot=_creator_snapshot(team, visits, payload, user),
    )
    db.add(record)
    db.flush()
    _persist_report_images(db, record.id, visits)
    db.commit()

    safe_number = payload.report_number.replace("/", "-")
    report_progress.advance('sections')
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_number}.docx"'},
    )


def _creator_snapshot(team, visits, payload, user):
    snapshot = capture_inspection_snapshot(team, visits, payload)
    snapshot["report_creator"] = {"id": user.id, "name": user.full_name or user.username,
                                  "username": user.username, "role": user.role}
    return snapshot


def _persist_blocks(
    db: Session, blocks, user: User, payload, report_type: str, generated_at: dt.datetime | None = None, merged_document: bytes | None = None
) -> LineInspectionReport | None:
    """One LineInspectionReport row per team-section in a grouped report — same traceability the
    single-team endpoint above gives, just one row per section instead of one for the whole file.
    The sign-off/condition fields are shared across every section of one grouped report (there's
    only one set of them on the request), so each row gets the same copy — needed so re-downloading
    any one section later reproduces it exactly, not just with the team/dates/number right. Each
    section's own standalone .docx is also archived (same as the single-team endpoint) and its
    images snapshotted, so every section is independently traceable/downloadable later.
    When merged_document is supplied, also archive the complete customer document
    and its combined snapshot in this same transaction. generated_at should be the
    same timestamp used to pick each block's auto report number (see
    render_area_report/render_consolidated_report) — defaults to now for a caller that doesn't
    already have one."""
    generated_at = generated_at or utcnow()
    from app.services import report_progress
    report_progress.stage('Saving report to library')
    for b in blocks:
        dates = [v.inspection_date for v in b.visits if v.inspection_date]
        record = LineInspectionReport(
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
            created_at=generated_at,
            report_type=report_type,
            line_sector=b.area,
            scope_towers=_report_tower_scope(b.visits),
            inspection_snapshot=_creator_snapshot(b.team, b.visits, payload, user),
            file_path=_save_report_file(b.report_number, generated_at, b.docx_bytes),
        )
        db.add(record)
        db.flush()
        _persist_report_images(db, record.id, b.visits)
    combined = None
    if merged_document is not None and blocks:
        visits = list({v.id: v for block in blocks for v in block.visits}.values())
        dates = [v.inspection_date for v in visits if v.inspection_date]
        scope_name = payload.area if report_type == 'area' else 'Complete project'
        snapshot = _creator_snapshot(blocks[0].team, visits, payload, user)
        snapshot['team_name'] = scope_name
        snapshot['report_scope'] = 'complete'
        snapshot['teams'] = [{'id': team.id, 'name': team.name} for team in {b.team.id: b.team for b in blocks}.values()]
        number = generate_report_number(db, f"Line-{scope_name}" if report_type == 'area' else 'Project', generated_at)
        # team_id anchors the existing schema; complete reports are never exposed to crew accounts.
        combined = LineInspectionReport(
            team_id=blocks[0].team.id, start_date=min(dates), end_date=max(dates),
            report_number=number, report_type='line' if report_type == 'area' else 'project',
            line_sector=payload.area if report_type == 'area' else None,
            scope_towers=_report_tower_scope(visits), inspection_snapshot=snapshot,
            created_by=user.id, created_at=generated_at,
            file_path=_save_report_file(number, generated_at, merged_document),
            **{field: getattr(payload, field, None) for field in (
                'overall_condition', 'probable_cause', 'corrective_action', 'additional_comments',
                'prepared_by', 'reviewed_by', 'approved_by', 'approval_date')},
        )
        db.add(combined)
        db.flush()
        _persist_report_images(db, combined.id, visits)
    db.commit()
    for _ in blocks:
        report_progress.advance('sections')
    return combined


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

    generated_at = utcnow()
    docx_bytes, blocks = render_area_report(db, payload, generated_at)
    saved = _persist_blocks(db, blocks, user, payload, report_type="area", generated_at=generated_at, merged_document=docx_bytes)

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{saved.report_number}.docx"'},
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

    generated_at = utcnow()
    docx_bytes, blocks = render_consolidated_report(db, payload, generated_at)
    saved = _persist_blocks(db, blocks, user, payload, report_type="consolidated", generated_at=generated_at, merged_document=docx_bytes)

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{saved.report_number}.docx"'},
    )


@router.get("/oetc-line-report/history", response_model=list[LineInspectionReportOut])
def oetc_line_report_history(
    admin_only: bool = False,
    team_id: int | None = None,
    tower_id: int | None = None,
    report_type: str | None = None,
    line_sector: str | None = None,
    start_date: dt.date | None = None,
    end_date: dt.date | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Past generated reports — for tracing/reprinting, and the client portal's report library (see
    LineInspectionReport for what's kept). A customer sees only explicitly shared report IDs.
    Admin/reviewer retain their existing visibility; team_leader is narrowed to their own team, and team_member sees none of
    this (their workspace is their own assigned missions, not team-wide reporting)."""
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    q = db.query(LineInspectionReport).options(
        joinedload(LineInspectionReport.team),
        joinedload(LineInspectionReport.tower),
        selectinload(LineInspectionReport.images).joinedload(ReportImage.position).joinedload(Position.visit).joinedload(Visit.tower),
        selectinload(LineInspectionReport.comments),
    )
    if user.role == UserRole.TEAM_LEADER.value:
        q = q.filter(LineInspectionReport.team_id == user.team_id, (LineInspectionReport.report_type.is_(None) | LineInspectionReport.report_type.notin_(['line', 'project']))) if user.team_id else q.filter(False)
    elif team_id:
        q = q.filter(LineInspectionReport.team_id == team_id)
    if user.role == UserRole.CLIENT.value:
        q = q.filter(LineInspectionReport.id.in_(user.allowed_report_ids or []))
    if report_type:
        q = q.filter(LineInspectionReport.report_type == report_type)
    if start_date:
        q = q.filter(LineInspectionReport.end_date >= start_date)
    if end_date:
        q = q.filter(LineInspectionReport.start_date <= end_date)
    if search:
        q = q.filter(LineInspectionReport.report_number.ilike(f"%{search}%"))
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start date")
    rows = q.order_by(LineInspectionReport.created_at.desc(), LineInspectionReport.id.desc()).all()
    lines = [name for (name,) in db.query(Area.name).all()]
    creator_ids = {r.created_by for r in rows if r.created_by is not None}
    creators = {u.id: u for u in db.query(User).filter(User.id.in_(creator_ids)).all()} if creator_ids else {}
    out = []
    for r in rows:
        creator = (r.inspection_snapshot or {}).get("report_creator")
        if creator is None:
            account = creators.get(r.created_by)
            creator = {"id": account.id, "name": account.full_name or account.username,
                       "username": account.username, "role": account.role} if account else {}
        if admin_only and creator.get("role") != UserRole.ADMIN.value:
            continue
        item = LineInspectionReportOut.model_validate(r)
        item.created_by_name = creator.get("name")
        item.created_by_username = creator.get("username")
        item.created_by_role = creator.get("role")
        item.team_name = r.inspection_snapshot['team_name'] if r.inspection_snapshot else (r.team.name if r.team else None)
        item.tower_name = next((t['name'] for t in (r.scope_towers or []) if t['id'] == r.tower_id), r.tower.tower_id if r.tower else None)
        # Older reports have no scope snapshot. Only infer membership from recorded evidence,
        # never today's team assignments, which could include towers absent from the report.
        scope = r.scope_towers
        if scope is None:
            scope = ([{"id": r.tower.id, "name": r.tower.tower_id}] if r.tower else
                     _report_tower_scope([image.position.visit for image in r.images if image.position and image.position.visit]))
        if tower_id and not any(t["id"] == tower_id for t in scope):
            continue
        if not item.line_sector and r.report_type in ('area', 'consolidated'):
            item.line_sector = _saved_scope_line(scope, lines)
        if line_sector and item.line_sector != line_sector:
            continue
        item.scope_towers = [ReportTowerScope.model_validate(t) for t in scope]
        item.has_file = bool(r.file_path and (settings.reports_dir / r.file_path).is_file())
        item.image_count = len(r.images)
        item.comment_count = len(r.comments)
        item.has_inspection_snapshot = r.inspection_snapshot is not None
        if r.comments:
            last = max(r.comments, key=lambda c: (c.created_at, c.id))
            item.last_comment_role = last.author_role
            item.last_comment_at = last.created_at
        out.append(item)
    return out


@router.get("/oetc-line-report/{report_id}/inspection-data")
def report_inspection_data(report_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found")
    _check_report_access(record, user)
    return {"snapshot": record.inspection_snapshot}


class DigitalReportExport(BaseModel):
    kind: Literal['xlsx', 'docx']
    finding_keys: list[str] = Field(min_length=1, max_length=100000)


class DigitalDocumentRequest(BaseModel):
    finding_keys: list[str] = Field(default_factory=list, max_length=100)
    section: Literal['findings', 'overview', 'measurements'] = 'findings'


def _digital_archive(record):
    if not record.file_path:
        return None
    path = (settings.reports_dir / record.file_path).resolve()
    return path if path.is_relative_to(settings.reports_dir.resolve()) and path.is_file() else None


@router.get('/oetc-line-report/{report_id}/digital-layout')
def digital_report_layout(report_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services.digital_report import archived_layout
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail='Report not found')
    _check_report_access(record, user)
    return {'findings': archived_layout(_digital_archive(record), record.inspection_snapshot or {})}


@router.post('/oetc-line-report/{report_id}/digital-document')
def digital_report_document(report_id: int, payload: DigitalDocumentRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services.digital_report import archived_finding_document
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail='Report not found')
    _check_report_access(record, user)
    try:
        data = archived_finding_document(_digital_archive(record), record.inspection_snapshot or {}, payload.finding_keys, overview=payload.section == 'overview', measurements=payload.section == 'measurements')
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(data, media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document', headers={'Cache-Control': 'private, no-store'})


@router.get('/oetc-line-report/{report_id}/digital-evidence')
def digital_report_evidence(report_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services.digital_report import archived_evidence_index
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail='Report not found')
    _check_report_access(record, user)
    return {'available': list(archived_evidence_index(_digital_archive(record), record.inspection_snapshot or {}))}


@router.get('/oetc-line-report/{report_id}/digital-evidence/{evidence_key}')
def digital_report_evidence_file(report_id: int, evidence_key: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from zipfile import ZipFile
    from app.services.digital_report import archived_evidence_index
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail='Report not found')
    _check_report_access(record, user)
    path = _digital_archive(record)
    member = archived_evidence_index(path, record.inspection_snapshot or {}).get(evidence_key)
    if not member:
        raise HTTPException(status_code=404, detail='Original photograph could not be associated safely. View the issued Word document.')
    with ZipFile(path) as archive:
        data = archive.read(member)
    from PIL import Image as PillowImage
    from io import BytesIO
    # Decode and re-encode raster evidence; never serve arbitrary archive parts as HTML/SVG.
    with PillowImage.open(BytesIO(data)) as image:
        image.thumbnail((1400, 1400))
        output = BytesIO()
        image.convert('RGB').save(output, format='JPEG', quality=88)
    return Response(output.getvalue(), media_type='image/jpeg', headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


@router.post('/oetc-line-report/{report_id}/digital-export')
def digital_report_export(report_id: int, payload: DigitalReportExport, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services.digital_report import export_snapshot, archived_finding_document
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail='Report not found')
    _check_report_access(record, user)
    if not record.inspection_snapshot:
        raise HTTPException(status_code=404, detail='This older report has no frozen inspection data. Use the archived document.')
    try:
        if payload.kind == 'docx':
            data = archived_finding_document(_digital_archive(record), record.inspection_snapshot, payload.finding_keys, f'Filtered extract from {record.report_number}. This is not a newly approved report. Original issued findings and photographs are retained below.')
        else:
            data = export_snapshot(record.inspection_snapshot, record.report_number, record.created_at, payload.finding_keys, payload.kind, _digital_archive(record))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    safe_number = re.sub(r'[^A-Za-z0-9._-]+', '-', record.report_number)
    mime = 'application/vnd.openxmlformats-officedocument.' + ('spreadsheetml.sheet' if payload.kind == 'xlsx' else 'wordprocessingml.document')
    return Response(data, media_type=mime, headers={'Content-Disposition': f'attachment; filename="{safe_number}-filtered-extract.{payload.kind}"', 'Cache-Control': 'private, no-store'})


@router.get("/oetc-line-report/{report_id}/inspection-data.pdf")
def report_inspection_data_pdf(report_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found")
    _check_report_access(record, user)
    if not record.inspection_snapshot:
        raise HTTPException(status_code=404, detail="This older report has no frozen inspection data. Use the archived document.")
    data = build_inspection_data_pdf(record.inspection_snapshot, record.report_number, record.created_at)
    safe_number = re.sub(r"[^A-Za-z0-9._-]+", "-", record.report_number)
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{safe_number}-inspection-data.pdf"'})


@router.get("/oetc-line-report/{report_id}/images", response_model=list[ReportImageOut])
def oetc_line_report_images(
    report_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every image snapshotted into this report at generation time (see used_image_ids) — the
    client portal's per-report image archive. Same access boundary as the report itself: a
    team_leader only their own team's reports, team_member refused, customers only shared reports."""
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found")
    _check_report_access(record, user)

    rows = (
        db.query(ReportImage)
        .options(joinedload(ReportImage.position).joinedload(Position.visit).joinedload(Visit.tower), joinedload(ReportImage.image))
        .filter(ReportImage.report_id == report_id)
        .all()
    )
    out = []
    for ri in rows:
        img = ri.image
        if img is None or ri.position is None or ri.position.visit is None:
            # The snapshotted Image row was later deleted (only ever possible for a non-baseline
            # extra — see routers/images.py's delete_image) — the snapshot itself stays as a
            # permanent record that this image WAS part of the report, but there's nothing left to
            # show for it, so skip rather than crash on a None image.
            continue
        pos = ri.position
        tower = pos.visit.tower
        out.append(
            ReportImageOut(
                id=ri.id,
                position_id=ri.position_id,
                image_id=ri.image_id,
                image_type=ri.image_type,
                position_code=pos.position_code,
                tower_id=tower.id,
                tower_code=tower.tower_id,
                area=tower.area,
                capture_date=img.capture_date,
                capture_time=img.capture_time,
                version_status=snapshot_image_status(record.inspection_snapshot, img),
                sequence=img.sequence,
            )
        )
    return out


@router.get("/oetc-line-report/{report_id}/comments", response_model=list[ReportCommentOut])
def oetc_line_report_comments(
    report_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """A report's comment thread, oldest first — how a client flags something for the internal
    team to act on, and how the team answers back. Same access boundary as the report itself."""
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found")
    _check_report_access(record, user)
    return db.query(ReportComment).filter(ReportComment.report_id == report_id).order_by(ReportComment.created_at, ReportComment.id).all()


@router.post("/oetc-line-report/{report_id}/comments", response_model=ReportCommentOut, status_code=201)
def add_oetc_line_report_comment(
    report_id: int,
    payload: ReportCommentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Posts to a report's comment thread — anyone who can see the report can write to it (same
    boundary as reading it), so a client can raise something and the team can reply, or the other
    way around."""
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found")
    _check_report_access(record, user)
    comment = ReportComment(
        report_id=report_id,
        author_id=user.id,
        author_name=user.full_name or user.username,
        author_role=user.role,
        body=payload.body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.patch("/oetc-line-report/{report_id}", response_model=LineInspectionReportOut)
def update_oetc_line_report(
    report_id: int,
    payload: LineInspectionReportUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Edits only the sign-off/assessment fields (see LineInspectionReportUpdate) — never the
    underlying readings, images, or the archived .docx itself, which stay exactly what was
    generated. An admin needs the usual generate_reports permission; a client account needs
    User.can_edit_reports; nobody else (reviewer included — sign-off is an admin/customer
    conversation, not a field-report task) may call this."""
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found")
    if user.role == UserRole.ADMIN.value:
        if not has_permission_level(user, "generate_reports", "full"):
            raise HTTPException(status_code=403, detail="Not enough permissions")
    elif user.role == UserRole.CLIENT.value:
        if not user.can_edit_reports:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        _check_report_access(record, user)
    else:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(record, k, v)
    db.commit()
    db.refresh(record)
    item = LineInspectionReportOut.model_validate(record)
    item.team_name = record.team.name if record.team else None
    item.tower_name = record.tower.tower_id if record.tower else None
    item.has_file = bool(record.file_path and (settings.reports_dir / record.file_path).is_file())
    item.image_count = len(record.images)
    item.comment_count = len(record.comments)
    item.has_inspection_snapshot = record.inspection_snapshot is not None
    return item


@router.delete("/oetc-line-report/{report_id}", status_code=204)
def delete_oetc_line_report(
    report_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently removes a generated report — its row, its archived .docx on disk, and (via
    cascade) its image-snapshot links and comment thread. Never touches the underlying field data
    (Position/Visit/Image rows) the report was built from, only the report document itself, so this
    is the right way to clear out a report that went out with wrong or stale information before
    regenerating a corrected one. Same actor boundary as editing one: an admin needs
    generate_reports at "full", a reviewer always, a team_leader only their own team's reports;
    nobody else (team_member, client — a client can already remove individual images it's allowed
    to, never a whole report) may call this."""
    record = db.get(LineInspectionReport, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found")
    if user.role == UserRole.ADMIN.value:
        if not has_permission_level(user, "generate_reports", "full"):
            raise HTTPException(status_code=403, detail="Not enough permissions")
    elif user.role == UserRole.REVIEWER.value:
        pass
    elif user.role == UserRole.TEAM_LEADER.value:
        if (user.team_id != record.team_id or record.report_type in ('line', 'project')):
            raise HTTPException(status_code=403, detail="You don't have access to this team")
    else:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    if record.file_path:
        path = settings.reports_dir / record.file_path
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            raise HTTPException(status_code=500, detail="Could not remove the archived file. The report has been retained; check storage permissions and retry.") from exc
    db.delete(record)
    for customer in db.query(User).filter(User.role == UserRole.CLIENT.value).all():
        if report_id in (customer.allowed_report_ids or []):
            customer.allowed_report_ids = [pk for pk in customer.allowed_report_ids if pk != report_id]
    db.commit()
    return None


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
    _check_report_access(record, user)
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    if user.role == UserRole.TEAM_LEADER.value and (user.team_id != record.team_id or record.report_type in ('line', 'project')):
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
    _check_report_access(record, user)
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    if user.role == UserRole.TEAM_LEADER.value and (user.team_id != record.team_id or record.report_type in ('line', 'project')):
        raise HTTPException(status_code=403, detail="You don't have access to this team")

    if record.report_type in ('line', 'project'):
        if record.file_path and (settings.reports_dir / record.file_path).is_file():
            return download_saved_oetc_report(report_id, db=db, user=user)
        raise HTTPException(status_code=404, detail='The complete archived report is unavailable. Generate a new report; a team section will not be substituted.')

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
    elif record.scope_towers is not None:
        visits_query = visits_query.filter(Visit.tower_id.in_([t["id"] for t in record.scope_towers]))
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
