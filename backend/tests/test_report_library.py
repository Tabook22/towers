"""Report library membership must follow saved reports, not current team assignments."""
import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import Session

from app.database import Base
from app.models import LineInspectionReport, Team, Tower, User, Visit
from app.routers import reports
from app.schemas import LineInspectionReportRequest
from app.services.oetc_report import generate_report_number
from app.migrations import add_missing_columns


@pytest.fixture
def library(tmp_path, monkeypatch):
    monkeypatch.setattr(reports.settings, 'reports_dir', tmp_path / 'reports')
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team = Team(name='Team 2')
        tower = Tower(tower_id='T-2', voltage='132')
        admin = User(username='admin', hashed_password='x', role='admin', is_super_admin=True)
        db.add_all([team, tower, admin])
        db.flush()
        visit = Visit(team_id=team.id, tower_id=tower.id, inspection_date=dt.date(2026, 9, 10))
        db.add(visit)
        db.commit()
        # Keep this suite about scope/storage rather than the template renderer.
        monkeypatch.setattr(reports, 'render_oetc_line_report_docx', lambda *args, **kwargs: b'archived original')
        reports.oetc_line_report(LineInspectionReportRequest(team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30)), db=db, user=admin)
        yield db, team, tower, admin


def test_team_report_is_found_by_tower_even_without_images(library):
    db, team, tower, admin = library
    tower.tower_id = 'RENAMED'
    tower.assigned_team_id = None
    db.commit()
    rows = reports.oetc_line_report_history(tower_id=tower.id, db=db, user=admin)
    assert len(rows) == 1
    assert rows[0].model_dump()['scope_towers'] == [{'id': tower.id, 'name': 'T-2'}]
    assert rows[0].has_file
    assert reports.oetc_line_report_history(tower_id=999, db=db, user=admin) == []


def test_history_uses_overlapping_inspection_dates_and_rejects_reversed_dates(library):
    db, _, _, admin = library
    assert len(reports.oetc_line_report_history(start_date=dt.date(2026, 9, 30), db=db, user=admin)) == 1
    assert reports.oetc_line_report_history(start_date=dt.date(2026, 10, 1), db=db, user=admin) == []
    with pytest.raises(HTTPException) as error:
        reports.oetc_line_report_history(start_date=dt.date(2026, 10, 1), end_date=dt.date(2026, 9, 1), db=db, user=admin)
    assert error.value.status_code == 422


def test_missing_file_is_not_advertised_as_an_archived_original(library):
    db, _, _, admin = library
    record = db.query(LineInspectionReport).one()
    (reports.settings.reports_dir / record.file_path).unlink()
    assert not reports.oetc_line_report_history(db=db, user=admin)[0].has_file


def test_failed_file_deletion_keeps_the_report_available(library, monkeypatch):
    from pathlib import Path
    db, _, _, admin = library
    record = db.query(LineInspectionReport).one()
    def fail_unlink(*args, **kwargs):
        raise PermissionError('Storage is read-only')
    monkeypatch.setattr(Path, 'unlink', fail_unlink)
    with pytest.raises(HTTPException) as error:
        reports.delete_oetc_line_report(record.id, db=db, user=admin)
    assert error.value.status_code == 500
    assert db.get(LineInspectionReport, record.id) is record


def test_regeneration_cannot_expand_into_new_towers(library, monkeypatch):
    db, team, tower, admin = library
    other = Tower(tower_id='T-99', voltage='132')
    db.add(other)
    db.flush()
    db.add(Visit(team_id=team.id, tower_id=other.id, inspection_date=dt.date(2026, 9, 10)))
    db.commit()
    seen = []
    def render(_team, visits, _payload, **kwargs):
        seen.extend(v.tower_id for v in visits)
        return b'regenerated'
    monkeypatch.setattr(reports, 'render_oetc_line_report_docx', render)
    reports.redownload_oetc_line_report(db.query(LineInspectionReport).one().id, db=db, user=admin)
    assert seen == [tower.id]


def test_team_leader_history_does_not_leak_other_team_reports(library):
    db, team, tower, _ = library
    leader = User(username='leader', role='team_leader', team_id=team.id + 1)
    assert reports.oetc_line_report_history(team_id=team.id, tower_id=tower.id, db=db, user=leader) == []


def test_exhausted_number_space_returns_actionable_conflict(library):
    db, _, _, _ = library
    used = {f'Team-20260923-{i}' for i in range(1000, 10000)}
    with pytest.raises(HTTPException) as error:
        generate_report_number(db, 'Team', dt.datetime(2026, 9, 23), exclude=used)
    assert error.value.status_code == 409


def test_scope_column_is_added_to_existing_databases_without_losing_reports():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text('ALTER TABLE line_inspection_reports DROP COLUMN scope_towers'))
        conn.execute(text("INSERT INTO line_inspection_reports (id, team_id, start_date, end_date, report_number, created_at) VALUES (1, 1, '2026-09-01', '2026-09-30', 'OLD-1', '2026-09-23')"))
    add_missing_columns(engine, Base)
    add_missing_columns(engine, Base)
    assert 'scope_towers' in {column['name'] for column in inspect(engine).get_columns('line_inspection_reports')}
    with engine.connect() as conn:
        assert conn.execute(text('SELECT report_number, scope_towers FROM line_inspection_reports')).one() == ('OLD-1', None)
