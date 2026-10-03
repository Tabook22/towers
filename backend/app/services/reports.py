"""Complete, wrapping inspection PDFs and compact progress summaries."""
from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting, Visit

def _load_org_branding(db: Session | None) -> dict:
    """Reads the admin-configured Organization Branding (SettingsPage.tsx) so generated reports
    carry the org's own name/logo/footer instead of a hardcoded app name — db is optional so
    report-building code can still run (with the old hardcoded defaults) in contexts with no
    session, e.g. a script or test that doesn't wire one up."""
    if db is None:
        return {}
    row = db.get(AppSetting, 1)
    if not row:
        return {}
    logo_path = None
    if row.org_logo_filename and not row.org_logo_filename.lower().endswith(".svg"):
        candidate = settings.branding_dir / row.org_logo_filename
        if candidate.exists():
            logo_path = str(candidate)
    return {
        "org_name": row.org_name_en or None,
        "org_logo_path": logo_path,
        "org_report_footer": row.org_report_footer or None,
        "org_contact": row.org_contact or None,
    }


def build_visit_report(visit: Visit, db: Session | None = None) -> bytes:
    # A readable, wrapping register replaces the tiny fixed-width table that lost notes and zeros.
    from types import SimpleNamespace
    from app.services.report_snapshot import capture_inspection_snapshot
    from app.services.inspection_data_pdf import build_inspection_data_pdf
    from app.services.report_images import selected_images
    snapshot = capture_inspection_snapshot(
        visit.team or SimpleNamespace(name='Unassigned team'), [visit], SimpleNamespace()
    )
    files = {image.id: settings.images_dir / (image.annotated_path or image.file_path)
             for position in visit.positions for image in selected_images(position)}
    return build_inspection_data_pdf(
        snapshot, f'{visit.tower.tower_id} · Visit {visit.id}', dt.datetime.now(dt.timezone.utc),
        evidence_files=files, branding=_load_org_branding(db), live=True,
    )


def build_overall_report(summary_rows: list[dict], area: str | None, db: Session | None = None) -> bytes:
    from app.services.inspection_data_pdf import build_overall_data_pdf
    return build_overall_data_pdf(summary_rows, area, _load_org_branding(db))
