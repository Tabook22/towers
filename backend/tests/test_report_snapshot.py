import datetime as dt
import json
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.database import Base
from app.migrations import add_missing_columns
from app.models import Image, LineInspectionReport, Position, Team, Tower, User, Visit
from app.routers import reports
from app.schemas import LineInspectionReportRequest, LineInspectionReportUpdate
from app.services.inspection_data_pdf import build_inspection_data_pdf
from app.services.oetc_report import build_oetc_line_report_context
from app.services.report_snapshot import capture_inspection_snapshot, snapshot_image_status
from pypdf import PdfReader


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setattr(reports.settings, 'reports_dir', tmp_path / 'reports')
    monkeypatch.setattr(reports, 'render_oetc_line_report_docx', lambda *a, **k: b'original document')
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team = Team(name='Team 2')
        tower = Tower(tower_id='Tower-101', area='South', voltage='132')
        admin = User(username='admin', role='admin', hashed_password='x', is_super_admin=True)
        db.add_all([team, tower, admin]); db.flush()
        visit = Visit(team_id=team.id, tower_id=tower.id, inspection_date=dt.date(2026, 10, 1),
                      inspector_name='Inspector', ambient_temp_c=0, humidity_pct=0, emissivity=0,
                      latitude=0, camera_drone='Camera A', calibration_cert_no='CERT-101')
        db.add(visit); db.flush()
        pos = Position(visit_id=visit.id, ohl='OHL1', phase='R', string='S1', view_side='Front',
                       tmax_c=0, tref_c=0, inspector_notes='Detailed finding without a direction',
                       screening_result='Normal', confidence='High', voice_note_path='PRIVATE-PATH',
                       voice_note_transcript='Recorded voice transcript')
        db.add(pos); db.flush()
        image = Image(position_id=pos.id, image_type='TH Full', sequence=1, file_path='PRIVATE-FILE',
                      checksum='original-checksum', include_in_report=True)
        db.add(image)
        db.add(Image(position_id=pos.id, image_type='RGB Full', sequence=1, file_path='SECRET-UNSELECTED', include_in_report=False))
        db.add(Position(visit_id=visit.id, ohl='OHL2', phase='B', string='S2', prepared_only=True))
        db.commit()
        payload = LineInspectionReportRequest(team_id=team.id, start_date=dt.date(2026, 10, 1),
                                              end_date=dt.date(2026, 10, 1), overall_condition='Monitor')
        reports.oetc_line_report(payload, db, admin)
        record = db.query(LineInspectionReport).one()
        yield db, record, team, tower, visit, pos, image, admin


def test_snapshot_is_complete_selected_and_customer_safe(data):
    db, record, _, _, _, _, image, _ = data
    snapshot = record.inspection_snapshot
    visit = snapshot['visits'][0]
    assert visit['ambient_temp_c'] == visit['humidity_pct'] == visit['latitude'] == 0
    assert visit['calibration_cert_no'] == 'CERT-101'
    assert len(visit['positions']) == 1
    pos = visit['positions'][0]
    assert pos['tmax_c'] == pos['tref_c'] == pos['delta_t'] == 0
    assert pos['inspector_notes'] == 'Detailed finding without a direction'
    assert pos['voice_note_transcript'] == 'Recorded voice transcript'
    assert [e['image_id'] for e in pos['evidence']] == [image.id]
    assert 'PRIVATE' not in json.dumps(snapshot) and 'SECRET' not in json.dumps(snapshot)


def test_snapshot_and_issued_assessment_do_not_drift(data):
    db, record, team, tower, visit, pos, image, admin = data
    original = json.dumps(record.inspection_snapshot, sort_keys=True)
    pos.tmax_c = 99; pos.inspector_notes = 'Later edit'; visit.camera_drone = 'Camera B'
    tower.tower_id = 'RENAMED'; image.checksum = 'replacement'; db.commit()
    reports.update_oetc_line_report(record.id, LineInspectionReportUpdate(overall_condition='Acceptable'), db, admin)
    assert json.dumps(reports.report_inspection_data(record.id, db, admin)['snapshot'], sort_keys=True) == original
    assert record.inspection_snapshot['assessment']['overall_condition'] == 'Monitor'
    assert snapshot_image_status(record.inspection_snapshot, image) == 'changed'
    gallery = reports.oetc_line_report_images(record.id, db, admin)
    assert gallery[0].version_status == 'changed' and gallery[0].sequence == 1
    assert (reports.settings.reports_dir / record.file_path).read_bytes() == b'original document'


def test_snapshot_access_boundary_and_legacy_are_explicit(data):
    db, record, _, _, _, _, _, _ = data
    client = User(username='customer', role='client')
    assert reports.report_inspection_data(record.id, db, client)['snapshot']
    for user in [User(username='crew', role='team_member'), User(username='other', role='team_leader', team_id=999)]:
        for endpoint in [reports.report_inspection_data, reports.report_inspection_data_pdf]:
            with pytest.raises(HTTPException) as error:
                endpoint(record.id, db, user)
            assert error.value.status_code == 403
    record.inspection_snapshot = None; db.commit()
    assert reports.report_inspection_data(record.id, db, client) == {'snapshot': None}
    with pytest.raises(HTTPException) as error:
        reports.report_inspection_data_pdf(record.id, db, client)
    assert error.value.status_code == 404


def test_pdf_handles_zero_unicode_long_notes_and_pagination(data):
    _, record, *_ = data
    snapshot = record.inspection_snapshot
    snapshot['visits'][0]['positions'][0]['inspector_notes'] = 'ΔT = 0 °C. Long customer finding. ' * 300
    pdf = build_inspection_data_pdf(snapshot, record.report_number, record.created_at)
    assert pdf.startswith(b'%PDF') and len(pdf) > 10000
    reader = PdfReader(BytesIO(pdf))
    content = '\n'.join(page.extract_text() for page in reader.pages)
    assert len(reader.pages) > 2
    # PDF line/page wrapping can split the phrase; all 300 terminal words must survive.
    assert content.count('finding.') == 300
    assert 'ΔT' in content and 'CERT-101' in content


def test_live_visit_pdf_includes_selected_photo_and_complete_notes(data, tmp_path, monkeypatch):
    from PIL import Image as PillowImage
    from app.services.reports import build_visit_report
    db, _, _, _, visit, _, image, _ = data
    monkeypatch.setattr(reports.settings, 'images_dir', tmp_path)
    image.file_path = 'selected.png'
    PillowImage.new('RGB', (90, 60), 'teal').save(tmp_path / image.file_path)
    db.commit()
    reader = PdfReader(BytesIO(build_visit_report(visit, db)))
    content = '\n'.join(page.extract_text() for page in reader.pages)
    assert 'Detailed finding without a direction' in content
    assert 'Recorded voice transcript' in content and 'CERT-101' in content
    assert 'PRIVATE' not in content and 'SECRET' not in content
    images = [obj.get_object() for page in reader.pages for obj in page.get('/Resources', {}).get('/XObject', {}).values() if obj.get_object().get('/Subtype') == '/Image']
    assert len(images) == 1


def test_overall_pdf_wraps_identities_and_repeats_headers():
    from app.services.inspection_data_pdf import build_overall_data_pdf
    rows = [{'tower_id': f'Long-transmission-line-tower-{i}', 'area': 'Extended south inspection area', 'possible_positions': 12, 'installed': 12, 'screened': 10, 'hotspots': 0, 'inconclusive': 0, 'images_pending': 0, 'completion_pct': 83, 'visit_status': 'draft'} for i in range(80)]
    reader = PdfReader(BytesIO(build_overall_data_pdf(rows, None, {})))
    assert len(reader.pages) > 1
    assert all('Images' in page.extract_text() and 'pending' in page.extract_text() for page in reader.pages[:-1])
    assert 'Long-transmission-line-tower-79' in reader.pages[-1].extract_text().replace('\n', '')


def test_preview_warns_about_drafts_and_rejects_layout_only(data):
    db, _, team, _, visit, pos, _, admin = data
    result = reports.oetc_report_preview(start_date=visit.inspection_date, end_date=visit.inspection_date, team_id=team.id, db=db, user=admin)
    assert result.ok and result.position_count == 1 and result.draft_visit_count == 1
    pos.in_scope = False; db.commit()
    result = reports.oetc_report_preview(start_date=visit.inspection_date, end_date=visit.inspection_date, team_id=team.id, db=db, user=admin)
    assert not result.ok and result.visit_count == 1 and result.position_count == 0


def test_mixed_conditions_do_not_claim_first_visit_values(data):
    _, _, team, _, visit, _, _, _ = data
    other = SimpleNamespace(**{key: getattr(visit, key) for key in ('camera_drone', 'camera_serial_no', 'calibration_cert_no', 'calibration_due_date', 'emissivity', 'distance_to_target_m', 'ambient_temp_c', 'humidity_pct', 'weather_wind', 'electrical_load', 'tower', 'inspection_date', 'mission_seq', 'inspector_name')}, positions=[], start_time=None)
    other.ambient_temp_c = 40
    payload = LineInspectionReportRequest(team_id=team.id, start_date=visit.inspection_date, end_date=visit.inspection_date)
    context = build_oetc_line_report_context(None, team, [visit, other], payload)
    assert context['ambient_temp'] == 'Varies by visit; see inspection data register'
    assert context['emissivity'] == 0


def test_additive_snapshot_migration_preserves_old_reports(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "old.db"}')
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text('ALTER TABLE line_inspection_reports DROP COLUMN inspection_snapshot'))
        conn.execute(text("INSERT INTO line_inspection_reports (id, team_id, start_date, end_date, report_number, created_at) VALUES (1, 1, '2026-10-01', '2026-10-01', 'LEGACY', '2026-10-01')"))
    add_missing_columns(engine, Base)
    assert 'inspection_snapshot' in {c['name'] for c in inspect(engine).get_columns('line_inspection_reports')}
    with engine.connect() as conn:
        assert conn.execute(text('SELECT report_number, inspection_snapshot FROM line_inspection_reports')).one() == ('LEGACY', None)
