"""Editing and deleting a saved inspection must not damage neighboring evidence."""
import asyncio
import datetime as dt
import io

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base
from app.models import Image, LineInspectionReport, Position, ReportImage, Team, ThermalEditGrant, User, VisitPhoto
from app.routers.images import apply_upload, save_annotation, _move_archived_file
from app.routers.positions import delete_position, get_position, update_position
from app.routers.visits import add_extra_position
from app.schemas import PositionCreate, PositionUpdate
from app.services.rollup import visit_rollup
from tests.test_multi_direction_positions import _admin_user, _make_visit


@pytest.fixture()
def db(tmp_path, monkeypatch):
    for name in ('images_dir', 'thumbnails_dir', 'voice_notes_dir'):
        root = tmp_path / name
        root.mkdir()
        monkeypatch.setattr(settings, name, root)
    engine = create_engine('sqlite:///:memory:')

    @event.listens_for(engine, 'connect')
    def enable_foreign_keys(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')

    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def add(db, visit, phase='R', user=None):
    return add_extra_position(visit.id, PositionCreate(
        ohl='OHL1', phase=phase, string='S1', direction='Ashoor',
        mount_type='Suspension', string_count='Single',
    ), db, user or _admin_user())


@pytest.mark.parametrize('role', ['admin', 'reviewer', 'inspector', 'team_leader', 'team_member'])
def test_each_inspection_role_can_edit_delete_and_repeat(db, role):
    team = Team(name='Crew')
    db.add(team); db.commit()
    user = User(username=role, role=role, team_id=team.id)
    visit = _make_visit(db, team.id)
    pos = add(db, visit, user=user)
    neighbor = add(db, visit, phase='Y', user=user)
    update_position(pos.id, PositionUpdate(ohl='OHL2', phase='B', inspector_notes='Correction'), db, user)
    old_id = pos.id
    db.expire_all()
    saved = get_position(old_id, db, user)
    assert (saved.ohl, saved.phase, saved.inspector_notes) == ('OHL2', 'B', 'Correction')
    delete_position(old_id, db, user)
    db.expire_all()
    assert db.get(Position, old_id) is None
    assert db.get(Position, neighbor.id) is not None
    assert len(visit.positions) == 1
    assert visit_rollup(visit)['installed'] == 1
    fresh = add_extra_position(visit.id, PositionCreate(
        ohl='OHL2', phase='B', string='S1', direction='Ashoor', string_count='Single',
    ), db, user)
    assert fresh.inspector_notes is None
    assert len(fresh.images) == 4
    assert all(img.file_path is None for img in fresh.images)


@pytest.mark.parametrize('role', ['team_leader', 'team_member'])
def test_edit_and_delete_respect_team_access(db, role):
    team = Team(name='Owner')
    db.add(team); db.commit()
    visit = _make_visit(db, team.id)
    pos = add(db, visit)
    outsider = User(username='outsider', role=role, team_id=team.id + 1)
    for action in (
        lambda: update_position(pos.id, PositionUpdate(phase='B'), db, outsider),
        lambda: delete_position(pos.id, db, outsider),
    ):
        with pytest.raises(HTTPException) as error:
            action()
        assert error.value.status_code == 403
    assert pos.phase == 'R' and len(pos.images) == 4


def test_duplicate_edit_is_rejected_without_overwriting_either_position(db):
    visit = _make_visit(db)
    pos, neighbor = add(db, visit), add(db, visit, phase='Y')
    with pytest.raises(HTTPException) as error:
        update_position(pos.id, PositionUpdate(phase='Y', inspector_notes='Should not save'), db, _admin_user())
    assert error.value.status_code == 409
    db.expire_all()
    assert pos.phase == 'R' and pos.inspector_notes is None
    assert neighbor.phase == 'Y' and len(neighbor.images) == 4


@pytest.mark.parametrize('payload', [{'ohl': 'OHL3'}, {'phase': 'Z'}, {'ohl': None}, {'phase': None}])
def test_invalid_identity_rejected(payload):
    with pytest.raises(ValueError):
        PositionUpdate(**payload)


def test_delete_removes_evidence_and_links_but_preserves_visit_photos_and_reports(db):
    team = Team(name='Crew')
    db.add(team); db.commit()
    visit = _make_visit(db, team.id)
    pos, neighbor = add(db, visit), add(db, visit, phase='Y')
    extra = Image(position_id=pos.id, image_type='TH Full', sequence=2, file_path='extra.jpg')
    db.add(extra); db.commit(); db.refresh(pos)
    image = pos.images[0]
    image.file_path = 'original.jpg'
    image.thumbnail_path = 'thumb.jpg'
    image.annotated_path = 'annotated.jpg'
    image.annotated_thumbnail_path = 'annotated-thumb.jpg'
    pos.voice_note_path = 'note.webm'
    files = [(settings.images_dir, name) for name in ['original.jpg', 'annotated.jpg', 'extra.jpg']]
    files += [(settings.thumbnails_dir, name) for name in ['thumb.jpg', 'annotated-thumb.jpg']]
    files += [(settings.voice_notes_dir, 'note.webm')]
    for root, name in files:
        (root / name).write_bytes(b'test evidence')
    (settings.images_dir / 'visit.jpg').write_bytes(b'general photo')
    neighbor.images[0].file_path = 'neighbor.jpg'
    (settings.images_dir / 'neighbor.jpg').write_bytes(b'neighbor')
    photo = VisitPhoto(visit_id=visit.id, position_id=pos.id, file_path='visit.jpg')
    report = LineInspectionReport(team_id=team.id, start_date=dt.date.today(), end_date=dt.date.today(), report_number='TEST', file_path='saved.docx')
    user = User(username='author', hashed_password='unused', role='admin')
    db.add_all([photo, report, user]); db.flush()
    link = ReportImage(report_id=report.id, position_id=pos.id, image_id=image.id, image_type=image.image_type)
    grant = ThermalEditGrant(token_hash='test', user_id=user.id, image_id=image.id,
        expected_revision=dt.datetime.now(), expires_at=dt.datetime.now(), edit_expires_at=dt.datetime.now())
    db.add_all([link, grant]); db.commit()
    position_id = pos.id
    delete_position(position_id, db, _admin_user())
    db.expire_all()
    assert db.query(Image).filter(Image.position_id == position_id).count() == 0
    assert db.query(ReportImage).count() == db.query(ThermalEditGrant).count() == 0
    assert db.get(VisitPhoto, photo.id).position_id is None
    assert db.get(LineInspectionReport, report.id).file_path == 'saved.docx'
    assert (settings.images_dir / 'visit.jpg').read_bytes() == b'general photo'
    assert (settings.images_dir / 'neighbor.jpg').read_bytes() == b'neighbor'
    assert all(not (root / name).exists() for root, name in files)
    with pytest.raises(HTTPException) as error:
        delete_position(position_id, db, _admin_user())
    assert error.value.status_code == 404


def test_edit_then_readd_old_slot_does_not_overwrite_evidence(db):
    visit = _make_visit(db)
    pos = add(db, visit)
    image = pos.images[0]
    # Thumbnail generation is intentionally best-effort for these test bytes.
    asyncio.run(apply_upload(image, b'original evidence', 'original.jpg', 'image/jpeg', None, None, None, None))
    db.commit()
    original_path = image.file_path
    def annotate(target, raw):
        return asyncio.run(save_annotation(target.id, UploadFile(file=io.BytesIO(raw), filename='annotation.jpg',
            headers=Headers({'content-type': 'image/jpeg'})), db, _admin_user()))
    annotate(image, b'original annotation')
    original_annotation = image.annotated_path
    image_id = image.id
    pos.voice_note_path = 'recording.webm'
    pos.inspector_notes = 'Retain this inspection'
    db.commit()
    update_position(pos.id, PositionUpdate(ohl='OHL2', phase='B', direction='Saada', string_count='Double', string='S2'), db, _admin_user())
    fresh = add(db, visit)
    fresh_image = next(i for i in fresh.images if i.image_type == image.image_type)
    asyncio.run(apply_upload(fresh_image, b'new inspection', 'new.jpg', 'image/jpeg', None, None, None, None))
    db.commit(); db.expire_all()
    annotate(fresh_image, b'new annotation')
    saved = db.get(Image, image_id)
    assert saved.image_code.startswith(pos.position_code)
    assert saved.file_path == original_path
    assert pos.inspector_notes == 'Retain this inspection' and pos.voice_note_path == 'recording.webm'
    assert (settings.images_dir / saved.file_path).read_bytes() == b'original evidence'
    assert (settings.images_dir / fresh_image.file_path).read_bytes() == b'new inspection'
    assert (settings.images_dir / original_annotation).read_bytes() == b'original annotation'
    assert (settings.images_dir / fresh_image.annotated_path).read_bytes() == b'new annotation'
    delete_position(fresh.id, db, _admin_user())
    assert (settings.images_dir / original_path).read_bytes() == b'original evidence'
    assert (settings.images_dir / original_annotation).read_bytes() == b'original annotation'


def test_retyping_into_a_freed_code_preserves_existing_file(db):
    (settings.images_dir / 'old.jpg').write_bytes(b'edited position evidence')
    (settings.images_dir / 'incoming.jpg').write_bytes(b'new evidence')
    moved = _move_archived_file(settings.images_dir, 'incoming.jpg', 'old.jpg')
    assert (settings.images_dir / 'old.jpg').read_bytes() == b'edited position evidence'
    assert moved != 'old.jpg'
    assert (settings.images_dir / moved).read_bytes() == b'new evidence'
