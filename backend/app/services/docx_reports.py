"""Word (.docx) report generation from a user-uploaded template — mail-merge style, via docxtpl
(docxtpl = python-docx + Jinja2, purpose-built for exactly this: fill placeholders in an existing
.docx into a new one). Unlike the fixed-layout PDF in services/reports.py, everything about how the
report looks — logo, brand color, fonts, sizes, table styling, section order — lives entirely in the
uploaded Word file itself; this module only ever supplies the *data* those placeholders reference.

The placeholder/context contract (what a template author can reference) is:
    tower       — the Tower ORM row (tower_id, voltage, area, tower_type, location_name, height_m,
                  latitude, longitude, notes)
    visit       — the Visit ORM row (inspection_date, inspector_name, weather_wind, electrical_load,
                  camera_drone, thermal_mode, emissivity, reflected_temp, permit_job_no, latitude,
                  longitude, status)
    rollup      — dict from services.rollup.visit_rollup (possible_positions, installed, screened,
                  hotspots, inconclusive, images_pending, completion_pct, visit_status)
    positions   — one dict per position (loop over this — `{% for p in positions %}` for a plain
                  data table, or `{%p for p in positions %}` / `{%p endfor %}` to repeat a whole
                  block including images, e.g. a "Position / Visual / Thermal" photo gallery — see
                  build_starter_template for both patterns). Fields on each:
                    position_code, ohl, phase, string, direction, tower_proximity, installed,
                    screening_result, hotspot, tmax_c, tref_c, delta_t, severity, confidence, inspector_notes,
                    observation (alias for inspector_notes — reads more naturally in a photo-gallery
                    caption than "inspector notes" does)
                    visual_image / thermal_image — InlineImage, ready to drop straight into
                        `{{ }}` (RGB Full preferred, falling back to RGB Close / TH Full → TH Close;
                        blank if neither has a photo yet — not an error)
                    visual_image_name / thermal_image_name — that chosen image's image_code
                    visual_timestamp / thermal_timestamp — that image's capture date + time
    generated_date — today's date as an ISO string
"""
from __future__ import annotations

import datetime as dt
import io

from docx import Document
from docx.shared import Mm, Pt

from app.config import settings
from app.models import Position, Visit
from app.services.rollup import visit_rollup


def _pick_image(position: Position, primary: str, fallback: str):
    for image_type in (primary, fallback):
        img = next((i for i in position.images if i.image_type == image_type and i.file_path), None)
        if img:
            return img
    return None


def _timestamp_text(img) -> str:
    if not img:
        return ""
    parts = [str(img.capture_date)] if img.capture_date else []
    if img.capture_time:
        parts.append(str(img.capture_time))
    return " ".join(parts)


def _inline_image(tpl, img):
    """An InlineImage bound to this exact render's DocxTemplate instance — docxtpl requires that
    binding to know which document it's injecting the picture into. `None` (no photo yet, or the
    file's gone missing from storage, or an unreadable one) becomes an empty string at render time
    via the `finalize` hook in render_visit_report_docx, the same way any other missing field blanks
    out."""
    if not img:
        return None
    path = settings.images_dir / img.file_path
    if not path.exists():
        return None
    from docxtpl import InlineImage
    from PIL import Image as PILImage

    try:
        # Re-encoded through PIL rather than handed to python-docx as the raw file: some real-world
        # camera/drone JPEGs carry an EXIF block python-docx's own (minimal, not-PIL-based) image
        # header parser can't handle — it trips over a truncated/nonstandard TIFF sub-IFD, and only
        # *during* Jinja's actual rendering pass (InlineImage stores the descriptor and defers
        # parsing it until then), too late for a try/except around just this constructor to catch.
        # Re-saving through PIL first — far more tolerant of real-world file quirks, and this
        # naturally drops the EXIF entirely — produces a clean, standard JPEG that doesn't hit that
        # code path at all, so the failure genuinely can't happen at render time either.
        with PILImage.open(path) as im:
            im = im.convert("RGB")
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=90)
            buf.seek(0)
        return InlineImage(tpl, buf, width=Mm(70))
    except Exception:
        return None  # e.g. a corrupt/unreadable image file — blank rather than fail the whole report


def _position_context(tpl, position: Position) -> dict:
    visual = _pick_image(position, "RGB Full", "RGB Close")
    thermal = _pick_image(position, "TH Full", "TH Close")
    return {
        "position_code": position.position_code,
        "ohl": position.ohl,
        "phase": position.phase,
        "string": position.string,
        "direction": position.direction,
        "tower_proximity": position.tower_proximity,
        "installed": position.installed,
        "screening_result": position.screening_result,
        "hotspot": position.hotspot,
        "tmax_c": position.tmax_c,
        "tref_c": position.tref_c,
        "delta_t": position.delta_t,
        "severity": position.severity,
        "confidence": position.confidence,
        "inspector_notes": position.inspector_notes,
        "observation": position.inspector_notes,
        "visual_image": _inline_image(tpl, visual),
        "visual_image_name": visual.image_code if visual else "",
        "visual_timestamp": _timestamp_text(visual),
        "thermal_image": _inline_image(tpl, thermal),
        "thermal_image_name": thermal.image_code if thermal else "",
        "thermal_timestamp": _timestamp_text(thermal),
    }


def render_visit_report_docx(visit: Visit, template_path) -> bytes:
    """Fills `template_path` (a .docx) with this visit's data and returns the rendered .docx bytes."""
    from docxtpl import DocxTemplate  # imported lazily: only needed on the docx-report code path
    from jinja2 import Environment

    tpl = DocxTemplate(str(template_path))
    context = {
        "tower": visit.tower,
        "visit": visit,
        "rollup": visit_rollup(visit),
        "positions": [_position_context(tpl, p) for p in visit.positions],
        "generated_date": dt.date.today().isoformat(),
    }
    # Plenty of fields here are legitimately unset (a position not yet screened, a visit header
    # field the inspector hasn't filled in, a position with no photo yet) — Jinja's default is to
    # print Python's `None` as the literal text "None", which would show up all over the finished
    # report. `finalize` runs on every {{ }} value right before it's written out, so this blanks it
    # everywhere instead of requiring every template author to remember `{{ x or '' }}` on every
    # single field — including the `visual_image`/`thermal_image` InlineImage slots, which are
    # `None` (not an error) whenever that position doesn't have a photo of that kind yet.
    jinja_env = Environment(finalize=lambda v: "" if v is None else v)
    tpl.render(context, jinja_env=jinja_env)
    buf = io.BytesIO()
    tpl.save(buf)
    return buf.getvalue()


def build_starter_template() -> bytes:
    """A working example .docx — download it, then reskin the fonts/colors/logo/layout in Word
    without touching the {{ }} / {%tr %} placeholder tags, and re-upload. Deliberately generated
    with python-docx (not hand-authored) so it's always in sync with the context contract above."""
    doc = Document()

    doc.add_heading("Tower Inspection Report", level=1)
    p = doc.add_paragraph()
    p.add_run("Generated ").italic = True
    r = p.add_run("{{ generated_date }}")
    r.italic = True

    doc.add_heading("Tower", level=2)
    for label, expr in [
        ("Tower ID", "{{ tower.tower_id }}"),
        ("Voltage", "{{ tower.voltage }}"),
        ("Area", "{{ tower.area }}"),
        ("Tower type", "{{ tower.tower_type }}"),
    ]:
        para = doc.add_paragraph()
        para.add_run(f"{label}: ").bold = True
        para.add_run(expr)

    doc.add_heading("Visit", level=2)
    for label, expr in [
        ("Inspection date", "{{ visit.inspection_date }}"),
        ("Inspector", "{{ visit.inspector_name }}"),
        ("Weather / wind", "{{ visit.weather_wind }}"),
        ("Camera / drone", "{{ visit.camera_drone }}"),
        ("Permit / job no.", "{{ visit.permit_job_no }}"),
    ]:
        para = doc.add_paragraph()
        para.add_run(f"{label}: ").bold = True
        para.add_run(expr)

    doc.add_heading("Summary", level=2)
    for label, expr in [
        ("Installed / Screened", "{{ rollup.screened }} / {{ rollup.installed }}"),
        ("Hotspots", "{{ rollup.hotspots }}"),
        ("Images pending", "{{ rollup.images_pending }}"),
        ("Completion", "{{ rollup.completion_pct }}%"),
        ("Status", "{{ rollup.visit_status }}"),
    ]:
        para = doc.add_paragraph()
        para.add_run(f"{label}: ").bold = True
        para.add_run(expr)

    doc.add_heading("Positions", level=2)
    headers = ["Position", "OHL", "Phase", "String", "Direction", "Inner/Outer", "Screening", "Severity", "ΔT (°C)"]
    # 4 rows: header, an opening loop-marker row, the actual data row (this is the one that repeats,
    # once per position), and a closing loop-marker row. docxtpl's `{%tr ... %}` row-loop tag works
    # by finding the *whole* <w:tr> containing it and collapsing that entire row down to a bare
    # `{% ... %}` — so the open and close markers each need their OWN row; put them both in the data
    # row instead (which seems like the obvious place) and docxtpl deletes everything between them,
    # including the data cells, since it's all one match. The marker rows show up as literal extra
    # rows when the template's opened in Word — that's expected scaffolding, not a mistake to tidy up.
    table = doc.add_table(rows=4, cols=len(headers))
    try:
        table.style = "Light Grid Accent 1"
    except KeyError:
        pass  # falls back to the default table look if that built-in style ever isn't available
    for cell, text in zip(table.rows[0].cells, headers):
        cell.paragraphs[0].add_run(text).bold = True

    table.rows[1].cells[0].paragraphs[0].add_run("{%tr for p in positions %}")
    data = table.rows[2].cells
    data[0].paragraphs[0].add_run("{{ p.position_code }}")
    data[1].paragraphs[0].add_run("{{ p.ohl }}")
    data[2].paragraphs[0].add_run("{{ p.phase }}")
    data[3].paragraphs[0].add_run("{{ p.string }}")
    data[4].paragraphs[0].add_run("{{ p.direction }}")
    data[5].paragraphs[0].add_run("{{ p.tower_proximity }}")
    data[6].paragraphs[0].add_run("{{ p.screening_result }}")
    data[7].paragraphs[0].add_run("{{ p.severity }}")
    data[8].paragraphs[0].add_run("{{ p.delta_t }}")
    table.rows[3].cells[0].paragraphs[0].add_run("{%tr endfor %}")

    doc.add_page_break()
    doc.add_heading("Evidence", level=2)
    hint = doc.add_paragraph()
    hint_run = hint.add_run(
        "One block per position, each with its photos if uploaded. This repeats a whole block — a "
        "heading, a table, two images — not just one table row, so it uses a paragraph-level loop "
        "(percent-p-for / percent-p-endfor) instead of the percent-tr-for kind above; put the open tag "
        "in its own paragraph before the block and the close tag in its own paragraph after it."
    )
    hint_run.italic = True
    hint_run.font.size = Pt(9)

    doc.add_paragraph().add_run("{%p for p in positions %}")

    block_heading = doc.add_paragraph()
    block_heading.add_run("Position: ").bold = True
    block_heading.add_run("{{ p.position_code }}")

    gallery = doc.add_table(rows=3, cols=2)
    try:
        gallery.style = "Table Grid"
    except KeyError:
        pass
    gallery.rows[0].cells[0].paragraphs[0].add_run("Visual").bold = True
    gallery.rows[0].cells[1].paragraphs[0].add_run("Thermal").bold = True
    gallery.rows[1].cells[0].paragraphs[0].add_run("{{ p.visual_image }}")
    gallery.rows[1].cells[1].paragraphs[0].add_run("{{ p.thermal_image }}")
    gallery.rows[2].cells[0].paragraphs[0].add_run("{{ p.visual_image_name }} — {{ p.visual_timestamp }}")
    gallery.rows[2].cells[1].paragraphs[0].add_run("{{ p.thermal_image_name }} — {{ p.thermal_timestamp }}")

    observation = doc.add_paragraph()
    observation.add_run("Observation: ").bold = True
    observation.add_run("{{ p.observation }}")

    doc.add_paragraph()  # breathing room between repeated blocks once this actually loops
    doc.add_paragraph().add_run("{%p endfor %}")

    doc.add_paragraph()
    note = doc.add_paragraph()
    # Deliberately NOT spelling out the literal double-curly-brace / percent-brace syntax here —
    # writing it out as an example is exactly what caused the very first version of this generator
    # to fail (docxtpl's own template engine parsed the example in this sentence as a real, empty
    # tag and errored). Described in words instead, on purpose.
    note_run = note.add_run(
        "This is a starter template, not a finished report — restyle freely (fonts, colors, your logo, "
        "spacing, section order) in Word, just leave the curly-brace placeholder tags above exactly as "
        "they are, then upload the .docx back into Reports."
    )
    note_run.italic = True
    note_run.font.size = Pt(9)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
