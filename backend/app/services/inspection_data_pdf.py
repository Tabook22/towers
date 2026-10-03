"""Readable companion to the customer's fixed Word form; no live-data regeneration."""
from io import BytesIO
from pathlib import Path
from html import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether

LABELS = {
    'tmax_c': 'Tmax (°C)', 'tref_c': 'Tref (°C)', 'delta_t': 'ΔT (°C)',
    'ambient_temp_c': 'Ambient temperature (°C)', 'humidity_pct': 'Humidity (%)',
    'distance_to_target_m': 'Distance to target (m)', 'gs_side': 'Ground / sky side',
    'voice_note_duration_seconds': 'Voice note duration (s)', 'reflected_temp': 'Reflected temperature (°C)',
}


def _font():
    # Native Windows and common Linux deployments. Never silently replace Unicode input.
    for path in (Path('C:/Windows/Fonts/arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')):
        if path.is_file():
            if 'InspectionData' not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont('InspectionData', str(path)))
            return 'InspectionData'
    raise RuntimeError('A Unicode report font is required. Install Arial or DejaVu Sans before generating inspection PDFs.')


def build_inspection_data_pdf(snapshot, report_number, issued_at, *, evidence_files=None, branding=None, live=False):
    stream = BytesIO()
    font = _font()
    branding = branding or {}
    body = ParagraphStyle('InspectionBody', fontName=font, fontSize=9, leading=14, spaceAfter=4, splitLongWords=True)
    heading = ParagraphStyle('InspectionHeading', parent=body, fontSize=14, leading=19, spaceBefore=14, spaceAfter=8, textColor=colors.HexColor('#123f50'), keepWithNext=True)
    title = ParagraphStyle('InspectionTitle', parent=heading, fontSize=23, leading=28)
    def paragraph(value, style=body):
        return Paragraph(escape(str(value)).replace('\n', '<br/>'), style)
    story = [paragraph(branding.get('org_name') or 'Insulator Inspector Pro', body), paragraph('Tower inspection report' if live else 'Inspection data register', title), paragraph(report_number, heading),
             paragraph(f"Issued {issued_at:%d %b %Y, %H:%M} UTC · {snapshot['team_name']}"),
             paragraph('Current visit data and selected photographs. This is not an issued official campaign report.' if live else 'Recorded field data at issue time. Use alongside the official Word report for photographs and approval. Online assessment edits do not change this register.'), Spacer(1, 10)]
    positions = [p for v in snapshot['visits'] for p in v['positions']]
    story.append(paragraph(f"{len(snapshot['visits'])} visits · {len(positions)} recorded positions · {sum(len(p['evidence']) for p in positions)} selected evidence images"))
    if branding.get('org_logo_path'):
        try:
            logo = Image(branding['org_logo_path'], width=100, height=45, kind='proportional', hAlign='LEFT')
            story.insert(0, logo)
        except (OSError, ValueError):
            pass

    def fields(values, excluded=(), context=None):
        rows = [[paragraph(LABELS.get(key, key.replace('_', ' ').capitalize())), paragraph(value)]
                for key, value in values.items() if key not in excluded and value is not None and value != '']
        if not rows:
            story.append(paragraph('No values recorded.'))
            return
        if context:
            rows.insert(0, [paragraph(context), ''])
        table = Table(rows, colWidths=[148, 359], hAlign='LEFT', splitByRow=0, splitInRow=1, repeatRows=1 if context else 0)
        table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#edf4f6')),
            ('LINEBELOW', (0, 0), (-1, -1), .3, colors.HexColor('#dbe5e9')),
            ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9),
            ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        if context:
            table.setStyle(TableStyle([('SPAN', (0, 0), (-1, 0)), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e4eef2'))]))
        story.append(table)

    story.append(paragraph('Assessment at issue time', heading))
    fields(snapshot['assessment'])
    for visit in snapshot['visits']:
        story.append(paragraph(f"{visit['tower']} · {visit.get('inspection_date') or 'Date not recorded'} · Visit {visit['id']}", heading))
        fields(visit, ('id', 'tower', 'positions'), context=f"{visit['tower']} · Visit {visit['id']} · {visit.get('inspection_date') or 'Date not recorded'}")
        for index, position in enumerate(visit['positions'], 1):
            location = ' · '.join(str(position.get(key) or '') for key in ('view_side', 'ohl', 'phase', 'string', 'direction')).strip(' ·')
            story.append(paragraph(f"{visit['tower']} · {visit.get('inspection_date') or 'Date not recorded'} · Position {index}", heading))
            story.append(paragraph(location))
            fields(position, ('id', 'evidence'), context=f"{visit['tower']} · {visit.get('inspection_date') or 'Date not recorded'} · Position {index} · {location}")
            evidence = position['evidence']
            story.append(paragraph('Selected evidence: ' + (', '.join(f"{e['image_type']} (image {e['image_id']})" for e in evidence) or 'None selected.')))
            if evidence_files:
                for item in evidence:
                    path = evidence_files.get(item['image_id'])
                    if not path or not path.is_file():
                        story.append(paragraph(f"{item['image_type']}: image unavailable."))
                        continue
                    try:
                        from PIL import Image as PillowImage
                        with PillowImage.open(path) as source:
                            width, height = source.size
                            source.verify()
                        scale = min(507 / width, 290 / height)
                        story.append(KeepTogether([Spacer(1, 10), paragraph(f"{visit['tower']} · {location} · {item['image_type']}"), Image(str(path), width=width * scale, height=height * scale, hAlign='LEFT')]))
                    except (OSError, ValueError):
                        story.append(paragraph(f"{item['image_type']}: image could not be rendered."))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont(font, 8)
        canvas.setFillColor(colors.HexColor('#52656e'))
        canvas.drawString(44, 26, report_number)
        canvas.drawRightString(A4[0] - 44, 26, f'Page {doc.page}')
        canvas.restoreState()
    if branding.get('org_report_footer') or branding.get('org_contact'):
        story.extend([Spacer(1, 14), paragraph(' · '.join(filter(None, [branding.get('org_report_footer'), branding.get('org_contact')])) )])
    doc = SimpleDocTemplate(stream, pagesize=A4, rightMargin=44, leftMargin=44, topMargin=36, bottomMargin=46, title=f'{report_number} — Inspection data register', author=snapshot['team_name'])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()


def build_overall_data_pdf(rows, area, branding):
    """Wrapping summary table with repeatable headers; identities are never truncated."""
    stream = BytesIO()
    font = _font()
    body = ParagraphStyle('SummaryBody', fontName=font, fontSize=8, leading=12, splitLongWords=True)
    heading = ParagraphStyle('SummaryHeading', parent=body, fontSize=21, leading=27, spaceAfter=12)
    def paragraph(value):
        return Paragraph(escape(str(value)), body)
    story = [paragraph(branding.get('org_name') or 'Insulator Inspector Pro'),
             Paragraph('Overall field inspection summary', heading), paragraph(area or 'All areas'), Spacer(1, 16)]
    headers = ['Tower', 'Area', 'Possible', 'Installed', 'Screened', 'Hotspots', 'Inconclusive', 'Images pending', 'Completion', 'Status']
    keys = ['tower_id', 'area', 'possible_positions', 'installed', 'screened', 'hotspots', 'inconclusive', 'images_pending', 'completion_pct', 'visit_status']
    data = [[paragraph(value) for value in headers]] + [[paragraph(('—' if row.get(key) is None else row[key]) if key != 'completion_pct' else f"{row.get(key, 0)}%") for key in keys] for row in rows]
    table = Table(data, colWidths=[174, 140, 48, 48, 48, 48, 62, 62, 62, 61], repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e4eef2')), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f6f9fa')]), ('LINEBELOW', (0, 0), (-1, -1), .3, colors.HexColor('#dbe5e9')), ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7)]))
    story.append(table)
    if not rows:
        story.append(paragraph('No tower inspections match this scope.'))
    for key in ('org_report_footer', 'org_contact'):
        if branding.get(key):
            story.extend([Spacer(1, 12), paragraph(branding[key])])
    def footer(canvas, doc):
        canvas.setFont(font, 8)
        canvas.drawRightString(landscape(A4)[0] - 44, 26, f'Page {doc.page}')
    SimpleDocTemplate(stream, pagesize=landscape(A4), leftMargin=44, rightMargin=44, topMargin=36, bottomMargin=44).build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()
