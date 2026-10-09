import contextlib
import json
import time
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base
from app.models import User
from app.routers import report_jobs as routes, reports
from app.schemas import LineInspectionReportRequest
from app.services import report_jobs as jobs, report_progress as progress


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'backups_dir', tmp_path / 'backups')
    engine = create_engine('sqlite:///' + (tmp_path / 'business.sqlite3').as_posix())
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(jobs, 'SessionLocal', factory)
    from app import backup_gate
    backup_gate.initialize_gate()
    with factory() as db:
        user = User(username='operator', hashed_password='hash', role='admin', is_super_admin=True, is_active=True)
        db.add(user)
        db.commit()
        owner = user.id
    yield factory, owner
    engine.dispose()


def request():
    return dict(team_id=1, start_date='2026-10-01', end_date='2026-10-08', report_number='PROGRESS-TEST')


def test_retried_start_reuses_job_and_rejects_changed_payload(isolated):
    _, owner = isolated
    token = str(uuid.uuid4())
    original, created = jobs.create(owner, token, 'team', request())
    again, created_again = jobs.create(owner, token, 'team', request())
    assert created and not created_again and original['id'] == again['id']
    with pytest.raises(HTTPException) as error:
        jobs.create(owner, token, 'team', {**request(), 'report_number': 'OTHER'})
    assert error.value.status_code == 409
    with pytest.raises(HTTPException):
        jobs.create(owner, str(uuid.uuid4()), 'team', request())


def test_job_progress_only_finishes_after_result_saved(isolated, monkeypatch):
    _, owner = isolated
    observed = []
    patch = jobs.patch
    def record(ident, **changes):
        value = patch(ident, **changes)
        observed.append(dict(value))
        if value['status'] == 'complete':
            assert (jobs.directory(ident) / 'report.docx').read_bytes() == b'PK-report'
        return value
    monkeypatch.setattr(jobs, 'patch', record)
    def render(payload, db, user):
        assert user.id == owner
        tracker = progress.current.get()
        tracker.data.update(total=3, sections_total=1)
        progress.stage('Building report section')
        progress.advance()
        tracker.emit(force=True)
        assert jobs.public(jobs.get(job['id']))['percent'] < 100
        progress.advance('sections')
        from fastapi import Response
        return Response(b'PK-report', headers={'Content-Disposition': 'attachment; filename="test.docx"'})
    monkeypatch.setattr(reports, 'oetc_line_report', render)
    job, _ = jobs.create(owner, str(uuid.uuid4()), 'team', request())
    jobs.run(job['id'])
    final = jobs.get(job['id'], owner)
    assert final['status'] == 'complete' and final['percent'] == 100 and final['completed'] == final['total'] == 3
    assert any(row['stage'] == 'Building report section' for row in observed)
    assert all(row['percent'] < 100 for row in observed if row['status'] != 'complete')
    assert 'payload' not in jobs.public(final) and 'owner' not in jobs.public(final)


def test_failed_job_keeps_partial_progress_and_no_download(isolated, monkeypatch):
    _, owner = isolated
    def fail(*args, **kwargs):
        raise HTTPException(400, 'No visits found')
    monkeypatch.setattr(reports, 'oetc_line_report', fail)
    job, _ = jobs.create(owner, str(uuid.uuid4()), 'team', request())
    jobs.run(job['id'])
    final = jobs.get(job['id'], owner)
    assert final['status'] == 'failed' and final['percent'] < 100 and final['error'] == 'No visits found'
    with pytest.raises(HTTPException) as error:
        routes.download(uuid.UUID(job['id']), user=User(id=owner))
    assert error.value.status_code == 409


def test_jobs_and_downloads_are_private(isolated):
    _, owner = isolated
    job, _ = jobs.create(owner, str(uuid.uuid4()), 'team', request())
    for endpoint in (routes.status, routes.download):
        with pytest.raises(HTTPException) as error:
            endpoint(uuid.UUID(job['id']), user=User(id=owner + 1))
        assert error.value.status_code == 404


def test_revoked_generation_permission_is_checked_by_worker(isolated):
    factory, owner = isolated
    job, _ = jobs.create(owner, str(uuid.uuid4()), 'team', request())
    with factory() as db:
        user = db.get(User, owner)
        user.is_active = False
        db.commit()
    jobs.run(job['id'])
    assert jobs.get(job['id'])['status'] == 'failed'


def test_stale_worker_is_interrupted_without_regenerating(isolated):
    _, owner = isolated
    job, _ = jobs.create(owner, str(uuid.uuid4()), 'team', request())
    with contextlib.closing(jobs.connect()) as conn, conn:
        stale = {**job, 'updated': time.time() - 181}
        conn.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(stale), job['id']))
    status = jobs.get(job['id'])
    assert status['status'] == 'interrupted' and status['percent'] == 0


def test_queued_job_receipt_stays_alive_before_executor_starts(isolated, monkeypatch):
    from concurrent.futures import Future
    _, owner = isolated
    job, _ = jobs.create(owner, str(uuid.uuid4()), 'team', request())
    refreshed = jobs.threading.Event()
    def rapid_heartbeat(ident, stopped):
        jobs.patch(ident)
        refreshed.set()
        stopped.wait()
    pending = Future()
    monkeypatch.setattr(jobs, 'heartbeat', rapid_heartbeat)
    monkeypatch.setattr(jobs.pool, 'submit', lambda *args: pending)
    jobs.dispatch(job['id'])
    assert refreshed.wait(2)
    waiting = jobs.get(job['id'])
    assert waiting['status'] == 'queued' and waiting['updated'] > job['updated']
    pending.set_result(None)


def test_team_leader_cannot_queue_other_team_or_grouped_reports(isolated):
    factory, _ = isolated
    leader = User(role='team_leader', team_id=2, is_active=True)
    with factory() as db:
        for kind in ('team', 'area', 'consolidated'):
            with pytest.raises(HTTPException) as error:
                jobs.authorize(db, leader, kind, LineInspectionReportRequest.model_validate(request()))
            assert error.value.status_code == 403


@pytest.mark.parametrize('kind,sections', [('team', 1), ('area', 1), ('consolidated', 1), ('area', 2), ('consolidated', 2)])
def test_real_report_job_counts_findings_photos_and_sections(isolated, monkeypatch, tmp_path, kind, sections):
    import datetime as dt
    from PIL import Image as Photo
    from app.models import Area, Team, Tower, Visit, Position, Image, LineInspectionReport
    factory, owner = isolated
    monkeypatch.setattr(settings, 'reports_dir', tmp_path / 'reports')
    monkeypatch.setattr(settings, 'images_dir', tmp_path / 'images')
    settings.images_dir.mkdir()
    Photo.new('RGB', (40, 30), 'red').save(settings.images_dir / 'test.jpg')
    with factory() as db:
        db.add(Area(name='Progress line'))
        for section in range(sections):
            team = Team(name=f'Progress team {section}')
            tower = Tower(tower_id=f'Progress-{section}', area='Progress line')
            db.add_all([team, tower])
            db.flush()
            visit = Visit(team_id=team.id, tower_id=tower.id, inspection_date=dt.date(2026, 10, 4))
            db.add(visit)
            db.flush()
            position = Position(visit_id=visit.id, ohl='OHL1', phase='R', string='S1', screening_result='Hotspot detected')
            db.add(position)
            db.flush()
            db.add(Image(position_id=position.id, image_type='RGB Full', sequence=1, file_path='test.jpg', include_in_report=True))
        db.commit()
        payload = {**request(), 'team_id': team.id, 'area': 'Progress line'}
    job, _ = jobs.create(owner, str(uuid.uuid4()), kind, payload)
    jobs.run(job['id'])
    final = jobs.get(job['id'])
    assert final['status'] == 'complete', final.get('error')
    assert (final['findings_done'], final['findings_total']) == (sections, sections)
    assert (final['photos_done'], final['photos_total']) == (sections, sections)
    assert (final['sections_done'], final['sections_total']) == (sections, sections)
    assert final['percent'] == 100 and final['completed'] == final['total'] == sections * 6 + 1
    with factory() as db:
        assert db.query(LineInspectionReport).count() == sections
