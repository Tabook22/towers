"""Recovery acceptance tests. Every database and storage root is isolated in tmp_path."""
import datetime as dt
import json
import shutil
import sqlite3
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image as PillowImage
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base
from app.deps import get_current_user, get_db
from app.models import User, Tower, Visit, Position, Image, Team, VisitPhoto, VisitEntryDraft, VisitDraftImage, ReportImage, KnowledgeDocument, VisitCreationRequest
from app.services import backups as service, backup_jobs as jobs
from app.backup_gate import initialize_gate, maintenance, BackupMaintenanceMiddleware
from app.routers import backups as routes
from app.routers.reports import oetc_line_report
from app.schemas import LineInspectionReportRequest


@pytest.fixture
def setup(tmp_path, monkeypatch):
    root_names = [name for name in service.roots() if name != 'channel_thumbnails']
    def instance(name, seed=False):
        directory = tmp_path / name; directory.mkdir(exist_ok=True)
        engine = create_engine('sqlite:///' + (directory / 'app.sqlite3').as_posix())
        Base.metadata.create_all(engine)
        monkeypatch.setattr(service, 'engine', engine)
        for root in root_names + ['backups']:
            folder = directory / root; folder.mkdir(exist_ok=True)
            monkeypatch.setattr(settings, root + '_dir', folder)
        initialize_gate()
        with Session(engine) as db:
            admin = User(id=1, username='recovery-admin', role='admin', is_super_admin=True, is_active=True, is_approved=True, hashed_password='$2b$12$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
            db.add(admin); db.commit()
            if seed:
                team = Team(id=1, name='Recovery team', leader_user_id=1)
                tower = Tower(id=1, tower_id='Ashoor-Saada-66', area='Dhofar', line_sector='Ashoor-Saada', assigned_team_id=1)
                db.add_all([team, tower]); db.flush()
                for ident in (1, 2):
                    visit = Visit(id=ident, tower_id=1, team_id=1, inspection_date=dt.date(2026, 9, 28 + ident), mission_seq=ident, inspector_name='Recovery inspector')
                    db.add(visit); db.flush()
                    pos = Position(id=ident, visit_id=ident, ohl='OHL1', phase='R', string='S1', direction='Ashoor', installed=True, hotspot='Yes', screening_result='Hotspot detected', tmax_c=31.2, tref_c=27.1)
                    db.add(pos); db.flush()
                    filename = f'evidence-{ident}.jpg'
                    PillowImage.new('RGB', (40, 30), 'red').save(settings.images_dir / filename)
                    shutil.copyfile(settings.images_dir / filename, settings.thumbnails_dir / filename)
                    db.add(Image(id=ident, position_id=ident, image_type='RGB Full', sequence=1, file_path=filename, thumbnail_path=filename, content_type='image/jpeg', evidence_status='COMPLETE', checksum=service.digest(settings.images_dir / filename), include_in_report=True))
                db.add(VisitPhoto(visit_id=1, position_id=1, file_path='evidence-1.jpg', thumbnail_path='evidence-1.jpg', original_filename='Context.jpg', content_type='image/jpeg', uploaded_by=1))
                db.add(VisitEntryDraft(id=1, visit_id=1, user_id=1, payload={'headerDraft': {'weather': 'Clear'}}, last_commit_token='SECRET-CONFIRM-TOKEN'))
                db.add(VisitCreationRequest(user_id=1, visit_id=1, token='SECRET-CREATION-TOKEN', fingerprint='receipt'))
                db.flush()
                db.add(VisitDraftImage(draft_id=1, token='idempotency-only', position_key=1, image_type='RGB Full', filename='Draft.jpg', content_type='image/jpeg', file_path='evidence-1.jpg', checksum=service.digest(settings.images_dir / 'evidence-1.jpg')))
                inline = settings.knowledge_base_dir / 'inline'; inline.mkdir()
                shutil.copyfile(settings.images_dir / 'evidence-1.jpg', inline / 'reference.jpg')
                db.add(KnowledgeDocument(title='Reference', file_path='inline/reference.jpg', original_filename='reference.jpg', content_type='image/jpeg', body_html='<img src="/api/knowledge-base/inline-images/reference.jpg">', uploaded_by=1))
                db.commit()
                response = oetc_line_report(LineInspectionReportRequest(team_id=1, tower_id=1, start_date=dt.date(2026,9,29), end_date=dt.date(2026,9,29), report_number='RECOVERY-TEST'), db, admin)
                assert response.body[:2] == b'PK'
        return engine, directory
    engine, directory = instance('source', seed=True)
    yield instance, engine, directory, tmp_path
    service.engine.dispose()
    engine.dispose()


def package(tmp_path):
    folder = tmp_path / 'snapshot'
    manifest = service.snapshot(folder)
    archive = tmp_path / 'inspection.zip'
    service.pack(folder, archive)
    validated = tmp_path / 'validated'
    assert service.validate_archive(archive, validated) == manifest
    return manifest, archive, validated


@pytest.mark.parametrize('mode', ['full', 'selective'])
def test_deleted_report_image_history_survives_backup_and_restore(setup, mode):
    instance, _, _, tmp = setup
    with service.connect(service.live_path()) as conn:
        row = conn.execute('SELECT id,report_id,position_id FROM report_images LIMIT 1').fetchone()
        assert row is not None
        conn.execute('UPDATE report_images SET image_id=999999 WHERE id=?', (row['id'],))
    manifest, _, validated = package(tmp)
    instance('deleted-image-destination')
    service.restore(validated, mode, [1] if mode == 'selective' else [], 'recovery-admin')
    with service.connect(service.live_path()) as conn:
        service.check_database(conn)
        assert conn.execute('SELECT image_id FROM report_images WHERE id=?', (row['id'],)).fetchone()[0] == 999999
        assert conn.execute('SELECT 1 FROM images WHERE id=999999').fetchone() is None


@pytest.mark.parametrize('field', ['report_id', 'position_id'])
def test_missing_report_history_parent_still_rejects_backup(setup, field):
    _, _, _, tmp = setup
    with service.connect(service.live_path()) as conn:
        conn.execute(f'UPDATE report_images SET "{field}"=999999')
    with pytest.raises(ValueError, match=f'Broken relationship: report_images.{field}'):
        service.snapshot(tmp / 'invalid-parent')


@pytest.mark.parametrize('before_creation_requests', [False, True])
@pytest.mark.parametrize('before_report_fields', [False, True])
def test_backup_before_viewing_sides_imports_without_assigning_old_readings(setup, before_creation_requests, before_report_fields):
    instance, engine, directory, tmp = setup
    folder = tmp / 'old-snapshot'
    manifest = service.snapshot(folder)
    database = folder / 'database.sqlite3'
    with service.connect(database) as conn:
        conn.execute('PRAGMA foreign_keys=OFF')
        if before_creation_requests:
            conn.execute('DROP TABLE visit_creation_requests')
            manifest['counts'].pop('visit_creation_requests')
        if before_creation_requests and before_report_fields:
            conn.execute('ALTER TABLE users DROP COLUMN first_name')
            conn.execute('ALTER TABLE users DROP COLUMN last_name')
        if before_report_fields:
            conn.execute('ALTER TABLE line_inspection_reports DROP COLUMN inspection_snapshot')
            conn.execute('ALTER TABLE team_archive_images DROP COLUMN relative_path')
        ddl = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='positions'").fetchone()[0]
        ddl = '\n'.join(line for line in ddl.splitlines() if not line.strip().startswith('view_side '))
        ddl = ddl.replace('direction, view_side)', 'direction)').replace('CREATE TABLE positions', 'CREATE TABLE old_view_positions', 1)
        conn.execute(ddl)
        columns = ','.join('"'+r['name']+'"' for r in conn.execute('PRAGMA table_info(positions)') if r['name'] != 'view_side')
        conn.execute(f'INSERT INTO old_view_positions ({columns}) SELECT {columns} FROM positions')
        conn.execute('DROP TABLE positions')
        conn.execute('ALTER TABLE old_view_positions RENAME TO positions')
    manifest['schema_version'] = service.schema_signature(before_view_side=True, before_creation_requests=before_creation_requests,
        before_report_snapshot=before_report_fields, before_archive_relative_path=before_report_fields,
        before_profile_names=before_creation_requests and before_report_fields)
    if before_creation_requests and before_report_fields:
        # Actual deployed release signature, not merely a fixture-derived expectation.
        assert manifest['schema_version'] == '23922df3695b4c5c747d75db57e2fad84416d916f1a91a1c0dbd3aa375f79e72'
    for item in manifest['members']:
        if item['path'] == 'database.sqlite3':
            item.update(size=database.stat().st_size, sha256=service.digest(database))
    (folder / 'manifest.json').write_text(json.dumps(manifest), encoding='utf8')
    archive = tmp / 'old-backup.zip'; service.pack(folder, archive)
    original_checksum = service.digest(archive)
    validated = tmp / 'old-validated'
    migrated = service.validate_archive(archive, validated)
    assert service.digest(archive) == original_checksum
    assert migrated['schema_version'] == service.schema_signature()
    assert migrated['source_schema_version'] == manifest['schema_version']
    with service.connect(validated / 'database.sqlite3') as conn:
        assert {r[0] for r in conn.execute('SELECT view_side FROM positions')} == {'Unspecified'}
        assert service.counts(conn) == migrated['counts']
        if before_report_fields:
            assert conn.execute('SELECT inspection_snapshot FROM line_inspection_reports').fetchone()[0] is None
    instance('old-backup-destination')
    service.restore(validated, 'full', [], 'recovery-admin')
    with service.connect(service.live_path()) as conn:
        assert {r[0] for r in conn.execute('SELECT view_side FROM positions')} == {'Unspecified'}
        assert service.counts(conn) == migrated['counts']


def test_backup_before_creation_receipts_restores_without_replay_tokens(setup):
    instance, _, _, tmp = setup
    folder = tmp / 'before-receipts'
    manifest = service.snapshot(folder)
    database = folder / 'database.sqlite3'
    with service.connect(database) as conn:
        conn.execute('DROP TABLE visit_creation_requests')
    manifest['counts'].pop('visit_creation_requests')
    manifest['schema_version'] = service.schema_signature(before_creation_requests=True)
    for item in manifest['members']:
        if item['path'] == 'database.sqlite3':
            item.update(size=database.stat().st_size, sha256=service.digest(database))
    (folder / 'manifest.json').write_text(json.dumps(manifest), encoding='utf8')
    archive = tmp / 'before-receipts.zip'; service.pack(folder, archive)
    validated = tmp / 'before-receipts-validated'
    migrated = service.validate_archive(archive, validated)
    assert migrated['counts']['visit_creation_requests'] == 0
    instance('before-receipts-destination')
    service.restore(validated, 'full', [], 'recovery-admin')
    with service.connect(service.live_path()) as conn:
        assert service.counts(conn) == migrated['counts']
        assert conn.execute('SELECT COUNT(*) FROM visits').fetchone()[0] == 2


def test_full_roundtrip_counts_images_metadata_reports_and_credentials(setup):
    instance, engine, directory, tmp = setup
    manifest, archive, validated = package(tmp)
    with zipfile.ZipFile(archive) as z:
        raw = z.read('database.sqlite3')
        assert (b'$2b$12$' + b'A'*53) in raw
        assert b'SECRET-CONFIRM' not in raw and b'SECRET-CREATION' not in raw
        assert any('Ashoor-Saada/Ashoor-Saada-66__tower-1/visit-1/images/' in p for p in z.namelist())
        assert 'RECOVERY-TEST' not in z.read('inspection-index.csv').decode('utf-8-sig')
    dest_engine, dest_dir = instance('destination')
    result = service.restore(validated, 'full', [], 'recovery-admin')
    assert result['records_to_import'] == manifest['counts']
    with service.connect(service.live_path()) as conn:
        assert service.counts(conn) == manifest['counts']
        service.check_database(conn)
        assert conn.execute('SELECT hashed_password FROM users WHERE id=1').fetchone()[0] == '$2b$12$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        for _, _, _, root, rel in service.file_references(conn):
            assert service.resolve_file(service.roots()[root], rel).is_file()
    with Session(dest_engine) as db:
        from app.services.reports import build_visit_report
        visit = db.get(Visit, 1)
        assert visit.inspector_name == 'Recovery inspector' and visit.positions[0].delta_t == 4.1
        image = db.get(Image, 1)
        restored_image_path = settings.images_dir / image.file_path
        assert image.position.visit.id == 1
        assert service.digest(settings.images_dir / image.file_path) == image.checksum
        PillowImage.open(settings.images_dir / image.file_path).verify()
        pdf = build_visit_report(visit, db)
        assert pdf.startswith(b'%PDF') and len(pdf) > 1000
        report = oetc_line_report(LineInspectionReportRequest(team_id=1, tower_id=1, start_date=dt.date(2026,9,29), end_date=dt.date(2026,9,30), report_number='RESTORED-REPORT'), db, db.get(User, 1))
        assert report.body[:2] == b'PK'
        body = db.query(KnowledgeDocument).one().body_html
        name = body.split('inline-images/')[1].split('"')[0]
        assert name != 'reference.jpg' and (settings.knowledge_base_dir / 'inline' / name).is_file()
    from app.routers import visits, images
    app = FastAPI(); app.include_router(visits.router); app.include_router(images.router)
    def session():
        with Session(dest_engine) as db: yield db
    app.dependency_overrides[get_db] = session
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username='recovery-admin', role='admin', is_super_admin=True)
    with TestClient(app) as client:
        opened = client.get('/api/visits/1')
        assert opened.status_code == 200, opened.text
        assert opened.json()['positions'][0]['tmax_c'] == 31.2
        image_response = client.get('/api/images/1/file')
        assert image_response.status_code == 200
        assert image_response.content == restored_image_path.read_bytes()
        assert client.get('/api/images/1/thumbnail').content == restored_image_path.read_bytes()
        assert client.get('/api/visits/1/photos/1/thumbnail').content == restored_image_path.read_bytes()


def test_selective_missing_visit_reuses_parents_and_rejects_duplicates(setup):
    instance, _, _, tmp = setup
    _, _, validated = package(tmp)
    engine, _ = instance('selective')
    service.restore(validated, 'selective', [1], 'recovery-admin')
    with Session(engine) as db:
        assert db.query(Visit).count() == 1
        assert db.query(Image).count() == 1
        assert db.query(ReportImage).count() == 1
        assert db.query(VisitPhoto).one().position_id == 1
    with pytest.raises(ValueError, match='already exists'):
        service.restore(validated, 'selective', [1], 'recovery-admin')
    service.restore(validated, 'selective', [2], 'recovery-admin')
    with Session(engine) as db:
        assert db.query(Visit).count() == 2 and db.query(Tower).count() == 1


def test_restore_rolls_back_database_and_staged_files_on_failure(setup):
    instance, _, _, tmp = setup
    _, _, validated = package(tmp)
    _, dest = instance('rollback')
    before = service.digest(service.live_path())
    def fail():
        raise RuntimeError('simulated crash before commit')
    with pytest.raises(RuntimeError):
        service.restore(validated, 'full', [], 'recovery-admin', before_commit=fail)
    assert service.digest(service.live_path()) == before
    assert not list(settings.images_dir.rglob('*.jpg'))


@pytest.mark.parametrize('problem', ['checksum', 'version', 'missing', 'traversal', 'orphan', 'malformed'])
def test_rejects_bad_archives_without_touching_live_data(setup, problem):
    _, _, _, tmp = setup
    _, archive, _ = package(tmp)
    with zipfile.ZipFile(archive) as z:
        items = {i.filename: z.read(i) for i in z.infolist()}
    manifest = json.loads(items['manifest.json'])
    if problem == 'checksum':
        items[manifest['files'][0]['path']] += b'corrupt'
    elif problem == 'version':
        manifest['format_version'] = 999
    elif problem == 'missing':
        del items[manifest['files'][0]['path']]
    elif problem == 'traversal':
        items['../outside.txt'] = b'bad'
    elif problem == 'malformed':
        manifest['files'][0]['size'] = -1
    else:
        modified = tmp / 'orphan.sqlite3'; modified.write_bytes(items['database.sqlite3'])
        with service.connect(modified) as c:
            c.execute('UPDATE positions SET visit_id=999 WHERE id=1')
        items['database.sqlite3'] = modified.read_bytes()
        db_info = next(x for x in manifest['members'] if x['path'] == 'database.sqlite3')
        db_info.update(size=modified.stat().st_size, sha256=service.digest(modified))
    items['manifest.json'] = json.dumps(manifest).encode()
    bad = tmp / 'bad.zip'
    with zipfile.ZipFile(bad, 'w') as z:
        for name, data in items.items(): z.writestr(name, data)
    before = service.digest(service.live_path())
    with pytest.raises(ValueError): service.validate_archive(bad, tmp / 'bad-extract')
    assert service.digest(service.live_path()) == before and not (tmp / 'outside.txt').exists()


def test_restore_job_requires_and_keeps_recovery_backup(setup, monkeypatch):
    instance, _, _, tmp = setup
    _, archive, _ = package(tmp)
    _, _ = instance('job-destination')
    source = jobs.create('upload', 'recovery-admin')
    shutil.copyfile(archive, jobs.directory(source['id']) / 'upload.zip')
    jobs.validate(source['id'])
    restore = jobs.create('restore', 'recovery-admin', source_id=source['id'])
    jobs.run(restore['id'], lambda: jobs.recover(restore['id'], source['id'], 'full', []))
    result = jobs.get(restore['id'])
    assert result['status'] == 'complete', result
    recovery = jobs.get(result['recovery_id'])
    assert recovery['status'] == 'complete' and recovery['summary']['counts']['visits'] == 0
    assert (jobs.directory(recovery['id']) / 'backup.zip').is_file()
    assert not (jobs.directory(restore['id']) / 'recheck').exists()


def test_api_authorization_chunk_offsets_confirmation_and_maintenance(setup, monkeypatch):
    _, _, _, tmp = setup
    app = FastAPI(); app.include_router(routes.router); app.add_middleware(BackupMaintenanceMiddleware)
    @app.get('/ordinary')
    def ordinary(): return {'ok': True}
    account = User(username='recovery-admin', role='admin', is_super_admin=False)
    app.dependency_overrides[get_current_user] = lambda: account
    monkeypatch.setattr(jobs, 'submit', lambda *args: None)
    with TestClient(app) as c:
        assert c.get('/api/backups').status_code == 403
        account.is_super_admin = True
        j = c.post('/api/backups/uploads', json={'size': 6}).json()
        path = '/api/backups/' + j['id']
        assert c.put(path + '/upload?offset=0', content=b'abc').status_code == 200
        assert c.put(path + '/upload?offset=0', content=b'abc').status_code == 409
        assert c.post(path + '/validate').status_code == 409
        assert c.put(path + '/upload?offset=3', content=b'def').status_code == 200
        assert c.get(path).json()['size'] == 6
        assert c.post(path + '/restore', json={'mode': 'full'}).status_code == 409
        with maintenance(exclusive=True):
            assert c.get('/ordinary').status_code == 503
            assert c.get('/api/backups').status_code == 200
            with pytest.raises(sqlite3.OperationalError):
                with maintenance(): pass
        assert c.get('/ordinary').status_code == 200
        assert c.delete(path).status_code == 204


def test_recovery_backup_failure_prevents_any_restore(setup, monkeypatch):
    instance, _, _, tmp = setup
    _, archive, _ = package(tmp)
    instance('failed-recovery')
    upload = jobs.create('upload', 'recovery-admin')
    shutil.copyfile(archive, jobs.directory(upload['id']) / 'upload.zip')
    job = jobs.create('restore', 'recovery-admin', source_id=upload['id'])
    before = service.digest(service.live_path())
    def fail(*args, **kwargs): raise ValueError('Simulated insufficient space')
    monkeypatch.setattr(service, 'pack', fail)
    jobs.run(job['id'], lambda: jobs.recover(job['id'], upload['id'], 'full', []))
    assert jobs.get(job['id'])['status'] == 'failed'
    assert service.digest(service.live_path()) == before
    assert not list(settings.images_dir.rglob('*.jpg'))


def test_missing_current_file_is_recorded_in_pre_restore_copy(setup):
    _, _, _, tmp = setup
    _, _, validated = package(tmp)
    (settings.images_dir / 'evidence-1.jpg').unlink()
    with pytest.raises(ValueError, match='Missing required attachment'):
        service.snapshot(tmp / 'ordinary-fails')
    current = service.snapshot(tmp / 'damaged-recovery', allow_missing=True)
    assert current['missing_files']
    service.restore(validated, 'full', [], 'recovery-admin')
    with service.connect(service.live_path()) as c:
        assert all(service.resolve_file(service.roots()[root], rel).is_file() for _,_,_,root,rel in service.file_references(c))


def test_selective_identifier_conflict_does_not_modify_target(setup):
    instance, _, _, tmp = setup
    _, _, validated = package(tmp)
    engine, _ = instance('conflict')
    with Session(engine) as db:
        db.add(Tower(id=1, tower_id='Different-tower')); db.commit()
    before = service.digest(service.live_path())
    with pytest.raises(ValueError, match='Conflicting identifier'):
        service.restore(validated, 'selective', [1], 'recovery-admin')
    assert service.digest(service.live_path()) == before


def test_wal_snapshot_excludes_live_session_credentials_and_worker_lock(setup):
    _, engine, _, tmp = setup
    from app.routers.live_help import LiveRoom, LiveSignal
    now = dt.datetime(2026, 9, 30)
    with Session(engine) as db:
        db.add(LiveRoom(id='call', caller=1, guest=1, caller_device='session-device', status='connected', created=now, expires=now, caller_seen=now, guest_seen=now))
        db.flush()
        db.add(LiveSignal(room_id='call', sender=1, nonce='session-nonce', kind='offer', payload='SECRET-WEBRTC-SESSION-CREDENTIAL'))
        db.commit()
    with service.connect(service.live_path()) as c:
        c.execute('PRAGMA journal_mode=WAL')
    _, archive, validated = package(tmp)
    with zipfile.ZipFile(archive) as z:
        assert b'SECRET-WEBRTC' not in z.read('database.sqlite3')
        assert not any(p.endswith(('-wal', '-shm', '-journal')) for p in z.namelist())
    script = "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1],timeout=0)\ntry:\n c.execute('BEGIN');c.execute('SELECT id FROM barrier').fetchone()\nexcept sqlite3.OperationalError:\n sys.exit(7)\nfinally:\n c.close()"
    from app.backup_gate import gate_path
    with maintenance(exclusive=True):
        other = subprocess.run([sys.executable, '-c', script, str(gate_path())], capture_output=True, timeout=10)
        assert other.returncode == 7, other.stderr
    assert subprocess.run([sys.executable, '-c', script, str(gate_path())], capture_output=True, timeout=10).returncode == 0


def test_legacy_channel_thumbnail_and_cross_visit_report_selection(setup):
    instance, engine, _, tmp = setup
    from app.models import TeamChannelMessage
    shutil.copyfile(settings.images_dir / 'evidence-1.jpg', settings.channel_dir / 'old-thumb.jpg')
    with Session(engine) as db:
        db.add(TeamChannelMessage(team_id=1, visit_id=1, field_date=dt.date(2026,9,29), photo_path='old-thumb.jpg', photo_thumb_path='old-thumb.jpg', photo_content_type='image/jpeg'))
        db.commit()
        oetc_line_report(LineInspectionReportRequest(team_id=1, tower_id=1, start_date=dt.date(2026,9,29), end_date=dt.date(2026,9,30), report_number='CROSS-VISIT'), db, db.get(User,1))
    _, _, validated = package(tmp)
    instance('legacy-restore')
    plan = service.restore(validated, 'selective', [1], 'recovery-admin')
    assert plan['omitted_cross_visit_reports']
    with service.connect(service.live_path()) as conn:
        thumb = conn.execute('SELECT photo_thumb_path FROM team_channel_messages').fetchone()[0]
        assert (settings.channel_dir / 'thumbs' / thumb).is_file()


def test_schedule_claim_is_shared_and_backup_status_survives_cleanup(setup, monkeypatch):
    calls = []
    monkeypatch.setattr(jobs, 'submit', lambda *args: calls.append(args))
    data = jobs.configure_schedule(dict(enabled=True, interval_hours=24, retention_days=14, retention_count=3), 'recovery-admin')
    due = data['next_run'] + 1
    jobs.scheduled_tick(due)
    jobs.scheduled_tick(due)
    assert len(calls) == 1
    automatic = jobs.get(calls[0][0])
    assert automatic['automatic'] is True
    jobs.patch(automatic['id'], status='complete', size=123, filename='inspection-backup-test.zip')
    info = jobs.overview()
    assert info['last_success']['id'] == automatic['id']
    assert any(e['action'] == 'configure_schedule' for e in info['audit'])
    assert any(e['action'] == 'backup' and e['status'] == 'complete' for e in info['audit'])


def test_new_controls_deny_non_full_administrators(setup):
    app = FastAPI(); app.include_router(routes.router)
    account = User(username='someone', role='team_member', is_super_admin=True)
    app.dependency_overrides[get_current_user] = lambda: account
    with TestClient(app) as client:
        for role, full in [('team_member', True), ('admin', False), ('client', True)]:
            account.role, account.is_super_admin = role, full
            assert client.post('/api/backups').status_code == 403
            assert client.get('/api/backups/overview').status_code == 403
            assert client.put('/api/backups/schedule', json={}).status_code == 403
            assert client.get('/api/backups/00000000-0000-0000-0000-000000000000/download').status_code == 403
            assert client.post('/api/backups/00000000-0000-0000-0000-000000000000/restore', json={'mode':'full','confirmation':'RESTORE'}).status_code == 403


def test_restore_requires_preview_and_rejects_merge_mode(setup, monkeypatch):
    _, _, _, tmp = setup
    _, archive, _ = package(tmp)
    source = jobs.create('upload', 'recovery-admin')
    shutil.copyfile(archive, jobs.directory(source['id']) / 'upload.zip')
    jobs.validate(source['id'])
    monkeypatch.setattr(jobs, 'submit', lambda *args: None)
    app = FastAPI(); app.include_router(routes.router)
    app.dependency_overrides[get_current_user] = lambda: User(username='recovery-admin', role='admin', is_super_admin=True)
    path = '/api/backups/' + source['id']
    with TestClient(app) as client:
        assert client.post(path+'/restore', json={'mode':'full','confirmation':'RESTORE'}).status_code == 409
        assert client.post(path+'/preview', json={'mode':'full'}).status_code == 200
        assert client.post(path+'/restore', json={'mode':'full','confirmation':'RESTORE'}).status_code == 202
        assert client.post(path+'/restore', json={'mode':'selective','confirmation':'RESTORE'}).status_code == 422


def test_format_one_remains_compatible_with_disabled_profiles(setup):
    _, _, _, tmp = setup
    folder = tmp / 'legacy-format-one'
    manifest = service.snapshot(folder)
    database = folder / 'database.sqlite3'
    with service.connect(database) as conn:
        conn.execute("UPDATE users SET hashed_password='!backup-password-excluded', is_active=0")
    manifest['format_version'] = 1
    for item in manifest['members']:
        if item['path'] == 'database.sqlite3':
            item.update(size=database.stat().st_size, sha256=service.digest(database))
    (folder / 'manifest.json').write_text(json.dumps(manifest), encoding='utf8')
    archive = tmp/'legacy-format-one.zip'
    service.pack(folder, archive)
    assert service.validate_archive(archive, tmp/'legacy-import')['format_version'] == 1


def test_format_two_restores_other_account_hash_and_status(setup):
    instance, engine, _, tmp = setup
    account_hash = '$2b$12$' + 'B'*53
    with Session(engine) as db:
        db.add(User(id=2, username='field-member', role='team_member', is_active=True,
                    is_approved=True, hashed_password=account_hash))
        db.commit()
    _, _, validated = package(tmp)
    instance('auth-destination')
    service.restore(validated, 'full', [], 'recovery-admin')
    with service.connect(service.live_path()) as conn:
        row = conn.execute('SELECT id,hashed_password,is_active FROM users WHERE username=?', ('field-member',)).fetchone()
        assert tuple(row) == (2, account_hash, 1)


def test_automatic_retention_preserves_manual_and_recent_copies(setup):
    manual = jobs.create('backup', 'recovery-admin')
    jobs.patch(manual['id'], status='complete', size=1, filename='manual.zip')
    automatic = []
    for _ in range(3):
        job = jobs.create('backup', 'recovery-admin', automatic=True)
        jobs.patch(job['id'], status='complete', size=1, filename='automatic.zip')
        automatic.append(job['id'])
    jobs.prune_scheduled(dict(retention_days=7, retention_count=1))
    assert jobs.get(manual['id'])['status'] == 'complete'
    assert jobs.get(automatic[-1])['status'] == 'complete'
    for old in automatic[:-1]:
        with pytest.raises(ValueError): jobs.get(old)
