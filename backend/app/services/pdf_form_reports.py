"""PDF report generation from a user-uploaded **fillable PDF form** template — pypdf fills named
AcroForm fields with real data, analogous to docx_reports.py's Word mail-merge but for PDF. Word can
repeat a table row per item in a list; a PDF form field can't — there's no dynamic loop construct in
the AcroForm spec — so this leans on something already true of this app: every visit always has
exactly the same 12 positions (2 OHL circuits x 3 phases x 2 strings, fixed — see models.py), so the
template just gets one flat, fixed field per (position slot 1-12, data field) instead of a loop.

Field-name contract a template author can use (see build_starter_pdf_form for a ready-made example
with every one of these already placed and labeled):
    Header fields (one each): tower_id, voltage, area, tower_type, inspection_date, inspector_name,
        weather_wind, camera_drone, permit_job_no, installed, screened, hotspots, inconclusive,
        images_pending, completion_pct, visit_status, generated_date
    Per-position fields — one set per slot 1-12, in POSITION_SLOT_ORDER's fixed OHL/phase/string
        order: position_{n}_code, position_{n}_ohl, position_{n}_phase, position_{n}_string,
        position_{n}_direction, position_{n}_proximity (Inner/Outer, blank unless the site actually
        has two insulator strings at that slot), position_{n}_screening, position_{n}_severity,
        position_{n}_delta_t
A field the template doesn't happen to include is simply never filled — no error either way.
"""
from __future__ import annotations

import datetime as dt
import io

from app.models import OHL_CHOICES, PHASE_CHOICES, STRING_CHOICES, Visit
from app.services.rollup import visit_rollup

POSITION_SLOT_ORDER: list[tuple[str, str, str]] = [
    (ohl, phase, string) for ohl in OHL_CHOICES for phase in PHASE_CHOICES for string in STRING_CHOICES
]

POSITION_FIELD_SUFFIXES = ["code", "ohl", "phase", "string", "direction", "proximity", "screening", "severity", "delta_t"]


def _blank(v: object) -> str:
    return "" if v is None else str(v)


def build_field_values(visit: Visit) -> dict[str, str]:
    """The {field_name: value} contract documented above — shared by the starter form's field layout
    and by the actual fill step below, so the two can never silently drift apart from each other."""
    tower = visit.tower
    r = visit_rollup(visit)
    values = {
        "tower_id": _blank(tower.tower_id),
        "voltage": _blank(tower.voltage),
        "area": _blank(tower.area),
        "tower_type": _blank(tower.tower_type),
        "inspection_date": _blank(visit.inspection_date),
        "inspector_name": _blank(visit.inspector_name),
        "weather_wind": _blank(visit.weather_wind),
        "camera_drone": _blank(visit.camera_drone),
        "permit_job_no": _blank(visit.permit_job_no),
        "installed": _blank(r["installed"]),
        "screened": _blank(r["screened"]),
        "hotspots": _blank(r["hotspots"]),
        "inconclusive": _blank(r["inconclusive"]),
        "images_pending": _blank(r["images_pending"]),
        "completion_pct": f"{r['completion_pct']}%",
        "visit_status": _blank(r["visit_status"]),
        "generated_date": dt.date.today().isoformat(),
    }

    # A Tension tower can have more than one Direction on the same (ohl, phase, string) — this
    # fixed-field PDF form has no loop construct to show a second one (see module docstring), so
    # keep the first (lowest id, i.e. the original baseline slot) and leave any further direction
    # for that slot off this particular export; the dynamic Word/other reports show every row.
    by_slot: dict[tuple[str, str, str], object] = {}
    for p in sorted(visit.positions, key=lambda p: p.id):
        by_slot.setdefault((p.ohl, p.phase, p.string), p)
    for i, combo in enumerate(POSITION_SLOT_ORDER, start=1):
        p = by_slot.get(combo)
        prefix = f"position_{i}_"
        if p is None:
            # Shouldn't happen — all 12 baseline slots always exist per visit — but stay safe if it ever does.
            for suffix in POSITION_FIELD_SUFFIXES:
                values[f"{prefix}{suffix}"] = ""
            continue
        values[f"{prefix}code"] = _blank(p.position_code)
        values[f"{prefix}ohl"] = _blank(p.ohl)
        values[f"{prefix}phase"] = _blank(p.phase)
        values[f"{prefix}string"] = _blank(p.string)
        values[f"{prefix}direction"] = _blank(p.direction)
        values[f"{prefix}proximity"] = _blank(p.tower_proximity)
        values[f"{prefix}screening"] = _blank(p.screening_result)
        values[f"{prefix}severity"] = _blank(p.severity)
        values[f"{prefix}delta_t"] = _blank(p.delta_t)
    return values


def render_visit_report_pdf_form(visit: Visit, template_path) -> bytes:
    """Fills `template_path` (a fillable PDF) with this visit's data and returns the flattened-look
    (but still a normal PDF, values just aren't blank) result."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject

    reader = PdfReader(str(template_path))
    writer = PdfWriter()
    writer.append(reader)

    values = build_field_values(visit)
    for page in writer.pages:
        writer.update_page_form_field_values(page, values, auto_regenerate=False)

    # Without this, some PDF viewers (notably not Acrobat, which always regenerates appearances
    # itself) keep showing the field boxes as blank even though the underlying value is set —
    # NeedAppearances tells the viewer "please redraw these fields from their values yourself".
    try:
        writer.set_need_appearances_writer(True)
    except Exception:
        root = writer._root_object
        if "/AcroForm" in root:
            from pypdf.generic import BooleanObject

            root["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True)

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def build_starter_pdf_form() -> bytes:
    """A working example fillable PDF — download it, reposition/restyle the field boxes (font,
    color, size, your logo as a background image) in a PDF form editor without renaming any field,
    then upload it back. Field *names* are what matter; visual layout is entirely up to the author."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()

    # --- Page 1: title + header fields ---
    c = canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4
    form = c.acroForm

    c.setFont("Helvetica-Bold", 18)
    c.drawString(40, page_h - 50, "Tower Inspection Report")
    c.setFont("Helvetica", 8)
    c.drawString(40, page_h - 65, "generated_date field is below — this line is just static text, not a field")

    header_fields = [
        ("Tower ID", "tower_id"), ("Voltage", "voltage"),
        ("Area", "area"), ("Tower type", "tower_type"),
        ("Inspection date", "inspection_date"), ("Inspector", "inspector_name"),
        ("Weather / wind", "weather_wind"), ("Camera / drone", "camera_drone"),
        ("Permit / job no.", "permit_job_no"), ("Generated date", "generated_date"),
        ("Installed", "installed"), ("Screened", "screened"),
        ("Hotspots", "hotspots"), ("Inconclusive", "inconclusive"),
        ("Images pending", "images_pending"), ("Completion %", "completion_pct"),
        ("Status", "visit_status"), ("", ""),
    ]
    col_w = (page_w - 80) / 2
    row_h = 34
    y = page_h - 100
    for i, (label, field) in enumerate(header_fields):
        if not field:
            continue
        col = i % 2
        row = i // 2
        x = 40 + col * col_w
        yy = y - row * row_h
        c.setFont("Helvetica", 8)
        c.drawString(x, yy + 14, label)
        form.textfield(
            name=field, x=x, y=yy - 4, width=col_w - 20, height=16,
            borderStyle="underlined", forceBorder=True, fontSize=9, value="",
        )
    c.showPage()

    # --- Page 2 (landscape, more room): the 12-position table ---
    c.setPageSize(landscape(A4))
    page_w, page_h = landscape(A4)
    form = c.acroForm

    c.setFont("Helvetica-Bold", 14)
    c.drawString(30, page_h - 30, "Positions")

    headers = ["Position", "OHL", "Phase", "String", "Direction", "Inner/Outer", "Screening", "Severity", "ΔT (°C)"]
    col_widths = [130, 40, 40, 40, 50, 60, 80, 65, 50]
    col_x = [30]
    for w in col_widths[:-1]:
        col_x.append(col_x[-1] + w)

    header_y = page_h - 55
    c.setFont("Helvetica-Bold", 8)
    for x, w, h in zip(col_x, col_widths, headers):
        c.drawString(x + 2, header_y, h)
    c.line(25, header_y - 4, col_x[-1] + col_widths[-1] + 5, header_y - 4)

    row_h = 20
    for slot in range(1, 13):
        row_y = header_y - 4 - slot * row_h
        prefix = f"position_{slot}_"
        for x, w, suffix in zip(col_x, col_widths, POSITION_FIELD_SUFFIXES):
            form.textfield(
                name=f"{prefix}{suffix}", x=x, y=row_y, width=w - 4, height=14,
                borderStyle="underlined", forceBorder=True, fontSize=7, value="",
            )
    c.showPage()
    c.save()
    return buf.getvalue()
