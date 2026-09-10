"""PDF report generation (fpdf2 — pure Python, no native/system dependencies)."""
from __future__ import annotations

import datetime as dt

from fpdf import FPDF

from app.config import settings
from app.models import Visit
from app.services.rollup import visit_rollup

SEVERITY_COLOR = {
    "Normal": (46, 125, 50),
    "Low": (154, 165, 24),
    "Medium": (245, 124, 0),
    "High": (211, 47, 47),
    "Critical": (106, 27, 154),
}
BRAND = (13, 71, 92)


class ReportPDF(FPDF):
    def header(self):
        self.set_fill_color(*BRAND)
        self.rect(0, 0, self.w, 18, style="F")
        self.set_xy(10, 4)
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 13)
        self.cell(0, 10, "Insulator Inspector Pro", ln=False)
        self.set_font("Helvetica", "", 9)
        self.set_xy(-70, 6)
        self.cell(60, 8, dt.date.today().isoformat(), align="R")
        self.set_text_color(0, 0, 0)
        self.ln(16)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "I", 7)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"Page {self.page_no()} - Confidential field inspection record", align="C")


def _kv_row(pdf: ReportPDF, label: str, value: str, w_label=45, w_value=90):
    pdf.set_font("Helvetica", "B", 8.5)
    pdf.cell(w_label, 6, label, border=0)
    pdf.set_font("Helvetica", "", 8.5)
    pdf.cell(w_value, 6, value or "-", border=0)


def build_visit_report(visit: Visit) -> bytes:
    r = visit_rollup(visit)
    pdf = ReportPDF(orientation="L", format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 9, f"Tower {visit.tower.tower_id} - Field Inspection Report", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(90, 90, 90)
    pdf.cell(0, 6, f"{visit.tower.voltage or ''}   |   Area: {visit.tower.area or '-'}", ln=True)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(2)

    col_w = 90
    y0 = pdf.get_y()
    pdf.set_x(10)
    _kv_row(pdf, "Inspection date:", str(visit.inspection_date or "-"))
    pdf.set_x(10 + col_w)
    _kv_row(pdf, "Inspector:", visit.inspector_name or "-")
    pdf.ln(6)
    pdf.set_x(10)
    _kv_row(pdf, "Weather / wind:", visit.weather_wind or "-")
    pdf.set_x(10 + col_w)
    _kv_row(pdf, "Electrical load:", visit.electrical_load or "-")
    pdf.ln(6)
    pdf.set_x(10)
    _kv_row(pdf, "Camera / drone:", visit.camera_drone or "-")
    pdf.set_x(10 + col_w)
    _kv_row(pdf, "Thermal mode:", visit.thermal_mode or "-")
    pdf.ln(6)
    pdf.set_x(10)
    _kv_row(pdf, "Emissivity:", str(visit.emissivity or "-"))
    pdf.set_x(10 + col_w)
    _kv_row(pdf, "Reflected temp (C):", str(visit.reflected_temp or "-"))
    pdf.ln(6)
    pdf.set_x(10)
    _kv_row(pdf, "Permit / Job No.:", visit.permit_job_no or "-")
    pdf.set_x(10 + col_w)
    _kv_row(pdf, "GPS:", f"{visit.latitude or '-'}, {visit.longitude or '-'}")
    pdf.ln(10)

    # KPI strip
    kpis = [
        ("Installed", r["installed"]),
        ("Screened", r["screened"]),
        ("Hotspots", r["hotspots"]),
        ("Inconclusive", r["inconclusive"]),
        ("Images pending", r["images_pending"]),
        ("Completion", f"{r['completion_pct']}%"),
        ("Status", r["visit_status"]),
    ]
    kpi_w = (pdf.w - 20) / len(kpis)
    pdf.set_font("Helvetica", "B", 8)
    for label, value in kpis:
        x = pdf.get_x()
        y = pdf.get_y()
        pdf.set_fill_color(240, 244, 247)
        pdf.rect(x, y, kpi_w - 2, 14, style="F")
        pdf.set_xy(x, y + 1.5)
        pdf.set_font("Helvetica", "", 7)
        pdf.cell(kpi_w - 2, 4, label, align="C", ln=0)
        pdf.set_xy(x, y + 6)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(kpi_w - 2, 6, str(value), align="C")
        pdf.set_xy(x + kpi_w, y)
    pdf.ln(18)

    # Position table
    headers = ["Position", "OHL", "Phase", "Str", "Dir", "In/Out", "Installed", "Screening", "Hotspot", "Tmax", "Tref", "dT", "Severity", "Confidence"]
    widths = [46, 14, 14, 10, 10, 14, 16, 32, 16, 14, 14, 12, 18, 18]
    pdf.set_font("Helvetica", "B", 7.5)
    pdf.set_fill_color(*BRAND)
    pdf.set_text_color(255, 255, 255)
    for h, w in zip(headers, widths):
        pdf.cell(w, 7, h, border=0, align="C", fill=True)
    pdf.ln()
    pdf.set_text_color(0, 0, 0)

    pdf.set_font("Helvetica", "", 7)
    fill = False
    for p in visit.positions:
        row = [
            p.position_code or "-",
            p.ohl,
            p.phase,
            p.string,
            p.direction or "-",
            p.tower_proximity or "-",
            "Yes" if p.installed else "No",
            p.screening_result,
            p.hotspot or "-",
            f"{p.tmax_c:.1f}" if p.tmax_c is not None else "-",
            f"{p.tref_c:.1f}" if p.tref_c is not None else "-",
            f"{p.delta_t:.1f}" if p.delta_t is not None else "-",
            p.severity or "-",
            p.confidence or "-",
        ]
        color = SEVERITY_COLOR.get(p.severity or "", None)
        pdf.set_fill_color(250, 250, 250 if not fill else 242)
        for val, w, h in zip(row, widths, headers):
            if h == "Severity" and color:
                pdf.set_text_color(*color)
                pdf.set_font("Helvetica", "B", 7)
            cell_h = 6
            pdf.cell(w, cell_h, str(val)[:22], border="B", align="C", fill=True)
            if h == "Severity":
                pdf.set_text_color(0, 0, 0)
                pdf.set_font("Helvetica", "", 7)
        pdf.ln()
        fill = not fill

    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 7.5)
    pdf.set_text_color(110, 110, 110)
    pdf.multi_cell(
        0,
        4,
        "Safety: UAV and electrical work must follow the asset owner's permit, minimum approach distance, "
        "aviation rules, site risk assessment and qualified-person requirements. Thermal hotspots are not "
        "automatically proof of corona; corona requires suitable UV/acoustic/PD confirmation.",
    )

    out = pdf.output()
    return bytes(out)


def build_overall_report(summary_rows: list[dict], area: str | None) -> bytes:
    pdf = ReportPDF(orientation="L", format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 9, "Overall Field Visit Summary" + (f" - {area}" if area else ""), ln=True)
    pdf.ln(4)

    headers = ["Tower", "Area", "Possible", "Installed", "Screened", "Hotspots", "Inconclusive", "Img pending", "Completion %", "Status"]
    widths = [40, 30, 22, 22, 22, 22, 26, 24, 26, 40]
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(*BRAND)
    pdf.set_text_color(255, 255, 255)
    for h, w in zip(headers, widths):
        pdf.cell(w, 7, h, align="C", fill=True)
    pdf.ln()
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 8)

    fill = False
    for row in summary_rows:
        vals = [
            row["tower_id"],
            row.get("area") or "-",
            row["possible_positions"],
            row["installed"],
            row["screened"],
            row["hotspots"],
            row["inconclusive"],
            row["images_pending"],
            f"{row['completion_pct']}%",
            row["visit_status"],
        ]
        pdf.set_fill_color(250, 250, 250 if not fill else 242)
        for v, w in zip(vals, widths):
            pdf.cell(w, 6.5, str(v), border="B", align="C", fill=True)
        pdf.ln()
        fill = not fill

    out = pdf.output()
    return bytes(out)
