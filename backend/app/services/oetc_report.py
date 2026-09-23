"""The customer's own "Transmission Line Insulator Thermal Inspection Report" — an official
deliverable they handed us as a filled-in example file, which we turned into a docxtpl template
(backend/app/templates/oetc_line_report.docx) by replacing every example value with a {{ }} merge
field and every "circle the right option" mark with a Jinja-driven checkbox state, otherwise
preserving its layout, wording, and styling (see the build script used to make it for exactly which
spots were templatized — same convention as services/field_execution_plan.py's bundled asset). One
deliberate addition since: a color-coded "Severity" column, right after ΔT (°C) in the Thermal
Inspection Measurements table, at the customer's own request — its cell shading is set from
`{{ m.severity_fill }}` (a real hex string by render time, see _severity_visual below) written
directly into the table cell's <w:shd w:fill="..."/> attribute in the template XML; docxtpl runs
Jinja over the whole raw document.xml, so a tag works there exactly as it does inside a run's
visible text, it's just not something python-docx's own table-building API can express.

One report covers a team's whole line campaign over a date range by default — the template's own
shape (one Line ID/date/report number, a repeating "Inspection findings" block per insulator, a
"Thermal Inspection Measurements" table with one row per reading) handles any number of towers'
worth of findings equally well. Passing `tower` narrows it to that one tower's visits only ("for a
particular tower", as opposed to "full towers") — same template, same rendering, just a filtered
`visits` list and a line_section that names the tower instead of the team's whole mission range.
Every raw reading comes straight from Position/Visit data; the report number and the engineer's
sign-off/assessment (LineInspectionReportRequest) exist only at report time and are persisted on
LineInspectionReport so a past report can be traced back to later.

A "finding" is only generated for a Position that actually has activity — Direction set or a real
image — same bar team_activity_report.py uses; an untouched 12-slot placeholder is noise here too.
"""
from __future__ import annotations

import datetime as dt
import io

from app.config import BASE_DIR
from app.models import IMAGE_TYPE_CHOICES, Position, Team, Tower, Visit
from app.schemas import LineInspectionReportRequest
from app.services.docx_reports import _inline_image
from app.services.team_activity_report import _position_has_activity, _position_sort_key
from app.services.tower_numbers import extract_tower_number

TEMPLATE_PATH = BASE_DIR / "app" / "templates" / "oetc_line_report.docx"


def _find_image(pos: Position, image_type: str):
    return next((i for i in pos.images if i.image_type == image_type and i.file_path), None)


def used_image_ids(visits: list[Visit]) -> list[tuple[int, int, str]]:
    """(position_id, image_id, image_type) for every image that actually gets embedded when this
    exact set of visits is rendered into a report — mirrors _finding_context's own selection
    (the 4 baseline evidence types, on any position with real activity) without needing a
    DocxTemplate or doing any actual rendering. Used to snapshot a report's ReportImage rows at
    generation time (see routers/reports.py) — the client portal's permanent report-to-image link."""
    out: list[tuple[int, int, str]] = []
    for v in sorted(visits, key=_visit_sort_key):
        for pos in sorted(v.positions, key=_position_sort_key):
            if not _position_has_activity(pos):
                continue
            for image_type in IMAGE_TYPE_CHOICES:
                img = _find_image(pos, image_type)
                if img:
                    out.append((pos.id, img.id, image_type))
    return out


def _derived_tower_proximity(pos: Position) -> str | None:
    """A double-string Tension position's Inner/Outer field is easy to leave unset — it's a
    separate manual dropdown, easy to forget — even though the app already labels the String
    picker itself "S1 — Outer" / "S2 — Inner" as a fixed convention (see frontend's
    AddPositionBar.STRING_LABELS) so the field crew never has to guess which physical string is
    which. Falls back to that same convention here whenever tower_proximity was never explicitly
    recorded, so the report doesn't come back blank just because that second field went unfilled.
    A manually-recorded value always wins — the crew's own read of the actual hardware overrides
    the naming convention, for the rare tower where a slot doesn't quite follow it."""
    if pos.tower_proximity:
        return pos.tower_proximity
    if pos.mount_type != "Tension" or pos.string_count != "Double":
        return None
    if pos.string == "S1":
        return "Outer"
    if pos.string == "S2":
        return "Inner"
    return None


def _finding_context(tpl, seq: int, visit: Visit, pos: Position) -> dict:
    return {
        "seq": seq,
        "tower_id": visit.tower.tower_id,
        "ohl": pos.ohl,
        "phase": pos.phase,
        "mount_type": pos.mount_type,
        "gs_side": pos.gs_side,
        # Every insulator on this line is composite — the field stays a real, editable dropdown
        # (see PositionPanel's "Insulator record" section) for the rare exception, but the report's
        # checkbox defaults to Composite rather than leaving both boxes unticked whenever an
        # inspector never touched this optional field, same convention as _derived_tower_proximity.
        "insulator_type": pos.insulator_type or "Composite",
        "string_count": pos.string_count,
        "tower_proximity": _derived_tower_proximity(pos),
        "manufacturer": pos.manufacturer,
        "year_installed": pos.year_installed,
        # All 4 of the position's baseline evidence slots, shown independently rather than picking
        # just one thermal + one visual — a report reviewer needs to see everything that was
        # actually captured, not the app's own "prefer Full, fall back to Close" internal choice.
        "thermal_full_image": _inline_image(tpl, _find_image(pos, "TH Full")),
        "thermal_close_image": _inline_image(tpl, _find_image(pos, "TH Close")),
        "visual_full_image": _inline_image(tpl, _find_image(pos, "RGB Full")),
        "visual_close_image": _inline_image(tpl, _find_image(pos, "RGB Close")),
        "pollution_condition": pos.pollution_condition,
        "thermal_indication": pos.thermal_indication,
        "visual_indications": pos.visual_indications,
        "remark": pos.inspector_notes,
    }


# ΔT severity bands the customer specified for the Thermal Inspection Measurements table's color
# column — (upper bound inclusive, label, cell fill, text color). abs() guards the rare negative
# reading (Tmax below Tref) — that's still an anomaly by magnitude, not a "Normal" one just because
# the sign happens to be negative. None (no reading yet) gets no color at all, checked separately.
_SEVERITY_BANDS: list[tuple[float, str, str, str]] = [
    (5.0, "Normal", "00B050", "FFFFFF"),
    (10.0, "Low", "FFFF00", "000000"),
    (20.0, "Medium", "FFC000", "000000"),
]
_SEVERITY_ABOVE_ALL_BANDS = ("High / Critical", "FF0000", "FFFFFF")


def _severity_visual(delta_t: float | None) -> tuple[str, str, str]:
    """(label, cell fill hex, text color hex) for the ΔT-driven severity swatch — see the
    "Severity Classification and Recommended Action" table the customer supplied: Normal <=5C
    (green), Low >5-10C (yellow), Medium >10-20C (orange), High/Critical >20C (red)."""
    if delta_t is None:
        return "", "FFFFFF", "000000"
    magnitude = abs(delta_t)
    for upper, label, fill, text_color in _SEVERITY_BANDS:
        if magnitude <= upper:
            return label, fill, text_color
    return _SEVERITY_ABOVE_ALL_BANDS


def _measurement_context(seq: int, visit: Visit, pos: Position) -> dict:
    severity_label, severity_fill, severity_text_color = _severity_visual(pos.delta_t)
    return {
        "seq": seq,
        "tower_id": visit.tower.tower_id,
        "tmax": pos.tmax_c,
        "tref": pos.tref_c,
        "delta_t": pos.delta_t,
        "load_current": visit.electrical_load,
        "severity": pos.severity,
        "severity_label": severity_label,
        "severity_fill": severity_fill,
        "severity_text_color": severity_text_color,
        "remarks": pos.inspector_notes,
    }


def _visit_sort_key(v: Visit):
    """Sorts by the tower's own trailing number — "Ashoor-Saada-29" before "...-32" before
    "...-36" — the order the customer actually walks the line in, rather than by whatever order
    the crew happened to visit/record them in. A tower ID with no trailing number (rare) sorts
    after every numbered one; ties (two areas sharing the same number) fall back to the tower ID
    string, then visit date/mission, so the order stays fully deterministic either way."""
    tower_id = v.tower.tower_id if v.tower else ""
    number = extract_tower_number(tower_id)
    return (number is None, number or 0, tower_id, v.inspection_date or dt.date.min, v.mission_seq or 0)


def build_oetc_line_report_context(
    tpl, team: Team, visits: list[Visit], payload: LineInspectionReportRequest, tower: Tower | None = None
) -> dict:
    visits = sorted(visits, key=_visit_sort_key)

    findings: list[dict] = []
    measurements: list[dict] = []
    inspectors: set[str] = set()
    seq = 0
    # The camera/calibration/environment fields are captured per visit but genuinely don't vary
    # within one campaign (same crew, same instrument) — the first visit that actually recorded a
    # camera stands in for the whole report rather than repeating a "which visit" question per field.
    equip = next((v for v in visits if v.camera_drone), visits[0] if visits else None)

    for v in visits:
        if v.inspector_name:
            inspectors.add(v.inspector_name)
        for pos in sorted(v.positions, key=_position_sort_key):
            if not _position_has_activity(pos):
                continue
            seq += 1
            findings.append(_finding_context(tpl, seq, v, pos))
            measurements.append(_measurement_context(seq, v, pos))

    voltage_level = next((v.tower.voltage for v in visits if v.tower and v.tower.voltage), "")
    # A single-tower report names that tower directly rather than the team's whole mission range,
    # since "1 to 70" would be misleading when only one of those towers is actually in this report.
    line_section = tower.tower_id if tower else " to ".join(filter(None, [team.mission_from, team.mission_to]))
    is_day = True
    if equip and equip.start_time:
        is_day = equip.start_time.hour < 18  # crude but reasonable: before 18:00 counts as daylight

    date_range = payload.start_date.isoformat()
    if payload.end_date != payload.start_date:
        date_range += f" to {payload.end_date.isoformat()}"

    return {
        "line_id": team.primary_sector or team.name,
        "report_date": dt.date.today().isoformat(),
        "report_number": payload.report_number,
        "line_name": team.primary_sector or team.name,
        "voltage_level": voltage_level,
        "line_section": line_section,
        "inspectors": ", ".join(sorted(inspectors)) or team.leader_name,
        "inspection_date": date_range,
        "inspection_time": "",
        "camera_make_model": equip.camera_drone if equip else None,
        "camera_serial_no": equip.camera_serial_no if equip else None,
        "calibration_cert_no": equip.calibration_cert_no if equip else None,
        "calibration_due_date": equip.calibration_due_date.isoformat() if equip and equip.calibration_due_date else None,
        "emissivity": equip.emissivity if equip else None,
        "distance_to_target": equip.distance_to_target_m if equip else None,
        "ambient_temp": equip.ambient_temp_c if equip else None,
        "humidity": equip.humidity_pct if equip else None,
        "wind_speed": equip.weather_wind if equip else None,
        "is_day": is_day,
        "load_current": equip.electrical_load if equip else None,
        "findings": findings,
        "measurements": measurements,
        "overall_condition": payload.overall_condition,
        "probable_cause": payload.probable_cause,
        "corrective_action": payload.corrective_action,
        "additional_comments": payload.additional_comments,
        "prepared_by": payload.prepared_by,
        "reviewed_by": payload.reviewed_by,
        "approved_by": payload.approved_by,
        "approval_date": payload.approval_date.isoformat() if payload.approval_date else None,
    }


def render_oetc_line_report_docx(
    team: Team, visits: list[Visit], payload: LineInspectionReportRequest, tower: Tower | None = None
) -> bytes:
    from docxtpl import DocxTemplate
    from jinja2 import Environment

    tpl = DocxTemplate(str(TEMPLATE_PATH))
    context = build_oetc_line_report_context(tpl, team, visits, payload, tower=tower)
    jinja_env = Environment(finalize=lambda v: "" if v is None else v)
    tpl.render(context, jinja_env=jinja_env)
    buf = io.BytesIO()
    tpl.save(buf)
    return buf.getvalue()
