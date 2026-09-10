"""Bulk tower import/update from an Excel (.xlsx) file — admin uploads a spreadsheet with one row
per tower, and it's upserted by Tower ID: an existing Tower ID gets its fields updated in place, a
new one gets created. Meant for standing up (or correcting) the tower list in one go — teams and
missions are built on top of towers, so getting a whole line's worth of them in at once, rather
than one form submission at a time, is the actual point.
"""
from __future__ import annotations

import io

from sqlalchemy.orm import Session

from app.models import Tower

# Column header -> Tower field. Matching is case-insensitive and whitespace-trimmed, and column
# ORDER in the sheet doesn't matter — only the header text does — so a real-world export from
# another system just needs its columns renamed/reordered to match, not rebuilt from scratch.
COLUMN_MAP: dict[str, str] = {
    "tower id": "tower_id",
    "voltage": "voltage",
    "tower type": "tower_type",
    "area": "area",
    "line sector": "line_sector",
    "location name": "location_name",
    "height (m)": "height_m",
    "height": "height_m",
    "latitude": "latitude",
    "longitude": "longitude",
    "notes": "notes",
}
HEADER_ROW = ["Tower ID", "Voltage", "Tower Type", "Area", "Line Sector", "Location Name", "Height (m)", "Latitude", "Longitude", "Notes"]
FLOAT_FIELDS = {"height_m", "latitude", "longitude"}
FLOAT_RANGES = {"height_m": (0, 1000), "latitude": (-90, 90), "longitude": (-180, 180)}


def build_tower_import_template() -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Towers"
    ws.append(HEADER_ROW)
    header_fill = PatternFill(start_color="0F3A4D", end_color="0F3A4D", fill_type="solid")
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
    ws.append(["ARSD 92", "132 kV", "Suspension (Tangent) Tower", "Dhofar", "Ittin - Thumrait", "Al Ain Corridor, Pole 14", 32.5, 17.01972, 54.08972, "Example row — edit or delete"])
    ws.freeze_panes = "A2"
    widths = [16, 12, 26, 14, 20, 26, 11, 12, 12, 30]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    notes = wb.create_sheet("Read me")
    notes.column_dimensions["A"].width = 90
    for line in [
        "How this import works",
        "",
        "- Tower ID is the only required column — it's the unique key.",
        "- If a Tower ID already exists in the system, that tower's other fields are UPDATED to match this row.",
        "- If a Tower ID doesn't exist yet, a new tower is created.",
        "- Leave a cell blank to leave that field untouched on an existing tower (blank does not erase it).",
        "- Height is in metres. Latitude/Longitude are decimal degrees (e.g. 17.01972, 54.08972).",
        "- Column order doesn't matter — only the header text in row 1 of the 'Towers' sheet does.",
        "- Delete the example row before uploading your real list, or just overwrite it.",
    ]:
        notes.append([line])
    notes["A1"].font = Font(bold=True, size=13)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _normalize_header(h) -> str:
    return str(h or "").strip().lower()


def _parse_float(value, field: str, row_num: int, warnings: list[str]) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        warnings.append(f"Row {row_num}: '{value}' isn't a number for {field} — left blank")
        return None
    lo, hi = FLOAT_RANGES[field]
    if not (lo <= f <= hi):
        warnings.append(f"Row {row_num}: {field}={f} is outside {lo}-{hi} — left blank")
        return None
    return f


def import_towers_from_excel(db: Session, raw: bytes) -> dict:
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as exc:  # a non-.xlsx file, corrupt upload, etc.
        return {"created": 0, "updated": 0, "total_rows": 0, "warnings": [f"Could not read that file as an Excel workbook: {exc}"]}

    # The first sheet is always the data sheet — "Towers" in the template, but don't require that
    # exact name in case someone renames or rebuilds the sheet from scratch.
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"created": 0, "updated": 0, "total_rows": 0, "warnings": ["That sheet is empty."]}

    header = [_normalize_header(h) for h in rows[0]]
    col_index: dict[str, int] = {}
    for i, h in enumerate(header):
        field = COLUMN_MAP.get(h)
        if field and field not in col_index:  # first matching column wins if a name repeats
            col_index[field] = i
    if "tower_id" not in col_index:
        return {
            "created": 0,
            "updated": 0,
            "total_rows": 0,
            "warnings": ["No 'Tower ID' column found in row 1 — download the template to see the expected headers."],
        }

    created = 0
    updated = 0
    warnings: list[str] = []
    seen_ids: set[str] = set()

    for row_num, row in enumerate(rows[1:], start=2):
        if row is None or all(c is None or str(c).strip() == "" for c in row):
            continue  # a blank spacer row — not an error, just skip it
        get = lambda field: row[col_index[field]] if field in col_index and col_index[field] < len(row) else None  # noqa: E731

        tower_id_raw = get("tower_id")
        tower_id = str(tower_id_raw).strip() if tower_id_raw is not None else ""
        if not tower_id:
            warnings.append(f"Row {row_num}: missing Tower ID — row skipped")
            continue
        if tower_id.lower() in seen_ids:
            warnings.append(f"Row {row_num}: duplicate Tower ID '{tower_id}' in this file — later row wins")
        seen_ids.add(tower_id.lower())

        tower = db.query(Tower).filter(Tower.tower_id.ilike(tower_id)).first()
        is_new = tower is None
        if is_new:
            tower = Tower(tower_id=tower_id)
            db.add(tower)
            # The session doesn't autoflush (see database.py) — without this, a second row for the
            # same new Tower ID later in this same file wouldn't find it via the query above and
            # would insert a duplicate instead of updating it.
            db.flush()
        else:
            tower.tower_id = tower_id  # normalize casing/whitespace to what's in the sheet

        for field in ("voltage", "tower_type", "area", "line_sector", "location_name", "notes"):
            value = get(field)
            if value is not None and str(value).strip() != "":
                setattr(tower, field, str(value).strip())

        for field in FLOAT_FIELDS:
            value = get(field)
            if value is not None and str(value).strip() != "":
                parsed = _parse_float(value, field, row_num, warnings)
                if parsed is not None:
                    setattr(tower, field, parsed)

        if is_new:
            created += 1
        else:
            updated += 1

    db.commit()
    return {"created": created, "updated": updated, "total_rows": created + updated, "warnings": warnings}
