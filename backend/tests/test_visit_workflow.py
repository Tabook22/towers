"""Tower preparation and batch entry preserve evidence, scope and report semantics."""
import datetime as dt
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session

from app.database import Base
from app.migrations import add_missing_columns
from app.models import User, Tower, Visit, Position, Image
from app.schemas import VisitCreate, PositionCreate, PositionUpdate, PreparePositions, PositionBatchUpdate
from app.routers.visits import create_visit_row, prepare_positions, update_positions_batch
from app.routers.positions import update_position
from app.services.rollup import visit_rollup
from app.services.team_activity_report import _position_has_activity
from app.services.report_images import selected_images


@pytest.fixture
def db():
    engine = create_engine('sqlite:///:memory:')
    @event.listens_for(engine, 'connect')
    def foreign_keys(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(username='workflow', hashed_password='unused', role='admin')
        tower = Tower(tower_id='Workflow-66', area='Ashoor-Saada')
        session.add_all([user, tower]); session.commit()
        yield session
    engine.dispose()


def make_visit(db):
    user = db.query(User).first()
    visit = create_visit_row(VisitCreate(tower_id=db.query(Tower).first().id), db, user)
    db.commit(); db.refresh(visit)
    return visit, user


@pytest.mark.parametrize('first_direction,second_direction', [('NA', 'Ashoor'), ('Ashoor', 'NA')])
def test_suspension_identity_guard_is_symmetric_and_keeps_views_separate(db, first_direction, second_direction):
    from app.routers.visits import add_extra_position
    visit, user = make_visit(db); position = visit.positions[0]
    update_position(position.id, PositionUpdate(direction=first_direction, mount_type='Suspension', string_count='Single'), db, user)
    values = dict(ohl=position.ohl, phase=position.phase, string=position.string, direction=second_direction, mount_type='Suspension', string_count='Single')
    with pytest.raises(HTTPException) as error:
        add_extra_position(visit.id, PositionCreate(**values), db, user)
    assert error.value.status_code == 409
    db.rollback()
    back = add_extra_position(visit.id, PositionCreate(**values, view_side='Back'), db, user)
    assert back.view_side == 'Back'
    assert db.get(Position, position.id).direction == first_direction


@pytest.mark.parametrize('raw', [b'', b'not a real image'])
def test_unreadable_direct_evidence_never_becomes_complete(db, raw):
    import asyncio
    from app.routers.images import apply_upload
    visit, user = make_visit(db)
    prepare_positions(visit.id, layout(visit), db, user)
    image = visit.positions[0].images[0]
    with pytest.raises(HTTPException) as error:
        asyncio.run(apply_upload(image, raw, 'photo.jpg', 'image/jpeg', None, None, None, None))
    assert error.value.status_code == 422
    assert image.file_path is None and image.evidence_status != 'COMPLETE'


def layout(visit, count='Single', save=False):
    return PreparePositions(slots=[PositionCreate(ohl=ohl, phase=phase, string=string,
        direction='Ashoor', mount_type='Suspension', string_count=count)
        for ohl in ('OHL1', 'OHL2') for phase in ('R', 'Y', 'B')
        for string in (('S1', 'S2') if count == 'Double' else ('S1',))],
        expected_versions={p.id: p.updated_at for p in visit.positions}, save_template=save)


def batch_item(pos, **changes):
    return dict(id=pos.id, expected_updated_at=pos.updated_at, changes=changes)


def test_six_positions_reuse_rows_and_do_not_create_blank_report_findings(db):
    visit, user = make_visit(db)
    ids = {p.id for p in visit.positions}
    image_ids = {i.id for p in visit.positions for i in p.images}
    result = prepare_positions(visit.id, layout(visit, save=True), db, user)
    assert len(result.positions) == 12
    assert {p.id for p in visit.positions} == ids
    assert {i.id for p in visit.positions for i in p.images} == image_ids
    assert sum(p.in_scope for p in visit.positions) == 6
    assert result.rollup.installed == result.rollup.possible_positions == 6
    assert result.rollup.images_pending == 24
    assert not any(_position_has_activity(p) for p in visit.positions)
    assert len(visit.tower.inspection_layout) == 6
    pos = next(p for p in visit.positions if p.in_scope)
    update_positions_batch(visit.id, PositionBatchUpdate(items=[batch_item(pos, hotspot='Yes', tmax_c=30, tref_c=25)]), db, user)
    assert _position_has_activity(pos)
    assert visit_rollup(visit)['screened'] == 1


def test_template_preserves_observations_and_images_and_rejects_omission(db):
    visit, user = make_visit(db)
    prepare_positions(visit.id, layout(visit, 'Double'), db, user)
    pos = next(p for p in visit.positions if p.string == 'S2')
    pos.inspector_notes = 'Actual finding'; pos.tmax_c = 31
    image = pos.images[0]; image.file_path = 'original.jpg'; image.include_in_report = True
    db.commit()
    original = (pos.id, image.id, image.image_code, image.file_path)
    prepare_positions(visit.id, layout(visit, 'Double'), db, user)
    assert (pos.id, image.id, image.image_code, image.file_path) == original
    assert pos.inspector_notes == 'Actual finding' and selected_images(pos) == [image]
    with pytest.raises(HTTPException) as error:
        prepare_positions(visit.id, layout(visit, 'Single'), db, user)
    assert error.value.status_code == 409
    assert sum(p.in_scope for p in visit.positions) == 12


def test_batch_is_atomic_on_invalid_later_row(db):
    visit, user = make_visit(db)
    a, b = visit.positions[:2]
    payload = PositionBatchUpdate(items=[batch_item(a, inspector_notes='Must roll back'), batch_item(b, string_count='Single')])
    with pytest.raises(HTTPException):
        update_positions_batch(visit.id, payload, db, user)
    assert db.get(Position, a.id).inspector_notes is None


def test_stale_batch_does_not_overwrite_either_inspector(db):
    visit, user = make_visit(db)
    a, b = visit.positions[:2]
    payload = PositionBatchUpdate(items=[batch_item(a, inspector_notes='First draft'), batch_item(b, inspector_notes='Stale draft')])
    update_position(b.id, PositionUpdate(inspector_notes='Other inspector saved'), db, user)
    with pytest.raises(HTTPException) as error:
        update_positions_batch(visit.id, payload, db, user)
    assert error.value.status_code == 409
    assert a.inspector_notes is None and b.inspector_notes == 'Other inspector saved'


def test_prepare_retry_is_safe_and_stale_layout_is_rejected(db):
    visit, user = make_visit(db)
    payload = layout(visit)
    prepare_positions(visit.id, payload, db, user)
    with pytest.raises(HTTPException) as error:
        prepare_positions(visit.id, payload, db, user)
    assert error.value.status_code == 409
    assert len(visit.positions) == 12
    prepare_positions(visit.id, layout(visit), db, user)
    assert len(visit.positions) == 12 and sum(p.in_scope for p in visit.positions) == 6


def test_repeat_visits_have_distinct_image_codes_without_renaming_originals(db):
    first, user = make_visit(db)
    prepare_positions(first.id, layout(first), db, user)
    first_codes = {i.image_code for p in first.positions for i in p.images if i.image_code}
    second, user = make_visit(db)
    prepare_positions(second.id, layout(second), db, user)
    second_codes = {i.image_code for p in second.positions for i in p.images if i.image_code}
    assert first_codes.isdisjoint(second_codes)
    assert len(first_codes) == len(second_codes) == 24
    assert {i.image_code for p in first.positions for i in p.images if i.image_code} == first_codes
    pos = next(p for p in second.positions if p.in_scope)
    old = [i.image_code for i in pos.images]
    update_position(pos.id, PositionUpdate(inspector_notes='Repeat inspection'), db, user)
    assert [i.image_code for i in pos.images] == old


def test_batch_cannot_cross_visit_or_team_boundary(db):
    visit, user = make_visit(db)
    other, _ = make_visit(db)
    with pytest.raises(HTTPException) as error:
        update_positions_batch(visit.id, PositionBatchUpdate(items=[batch_item(other.positions[0], hotspot='No')]), db, user)
    assert error.value.status_code == 422
    outsider = User(id=99, username='outsider', role='team_leader', team_id=999)
    with pytest.raises(HTTPException) as error:
        prepare_positions(visit.id, layout(visit), db, outsider)
    assert error.value.status_code == 403


def test_additive_migration_preserves_legacy_scope_and_report_inclusion():
    engine = create_engine('sqlite:///:memory:')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE positions (id INTEGER PRIMARY KEY, direction TEXT)'))
        conn.execute(text("INSERT INTO positions VALUES (1, 'Ashoor')"))
        conn.execute(text('CREATE TABLE towers (id INTEGER PRIMARY KEY)'))
    add_missing_columns(engine, Base)
    with engine.connect() as conn:
        assert conn.execute(text('SELECT in_scope, prepared_only, image_namespace FROM positions')).one() == (1, 0, None)
    assert 'inspection_layout' in {c['name'] for c in inspect(engine).get_columns('towers')}
    engine.dispose()


def test_queued_upload_retries_are_idempotent_and_cannot_overwrite_a_filled_slot(db, tmp_path, monkeypatch):
    import asyncio
    import io
    from PIL import Image as PILImage
    from starlette.datastructures import UploadFile
    from app.config import settings
    from app.routers.images import upload_image
    from app.routers.positions import add_extra_image
    from starlette.datastructures import Headers
    for name in ('images_dir', 'thumbnails_dir'):
        path = tmp_path / name; path.mkdir(); monkeypatch.setattr(settings, name, path)
    visit, user = make_visit(db)
    prepare_positions(visit.id, layout(visit), db, user)
    pos = next(p for p in visit.positions if p.in_scope)
    baseline = pos.images[0]
    output = io.BytesIO(); PILImage.new('RGB', (20, 20), 'red').save(output, format='JPEG')
    def file():
        return UploadFile(io.BytesIO(output.getvalue()), filename='sample.jpg', headers=Headers({'content-type': 'image/jpeg'}))
    def primary(token):
        return asyncio.run(upload_image(baseline.id, file(), None, None, None, None, db, user, token))
    original = primary('first-request'); path = original.file_path
    assert primary('first-request').id == original.id
    assert baseline.file_path == path
    with pytest.raises(HTTPException) as error:
        primary('different-request')
    assert error.value.status_code == 409
    db.rollback()
    with pytest.raises(HTTPException) as error:
        primary(None)
    assert error.value.status_code == 409
    db.rollback()
    assert asyncio.run(add_extra_image(pos.id, baseline.image_type, file(), None, None, None, None, db, user, 'duplicate-content')).id == original.id
    output = io.BytesIO(); PILImage.new('RGB', (20, 20), 'blue').save(output, format='JPEG')
    def extra():
        return asyncio.run(add_extra_image(pos.id, baseline.image_type, file(), None, None, None, None, db, user, 'extra-request'))
    added = extra(); added_id = added.id
    assert extra().id == added_id
    assert db.query(Image).filter(Image.position_id == pos.id).count() == 5
    assert baseline.file_path == path


def test_batch_validation_rejects_conflicting_results_and_nonfinite_measurements(db):
    visit, user = make_visit(db)
    pos = visit.positions[0]
    with pytest.raises(HTTPException) as error:
        update_positions_batch(visit.id, PositionBatchUpdate(items=[batch_item(pos, screening_result='Normal', hotspot='Yes')]), db, user)
    assert error.value.status_code == 422
    assert pos.screening_result == 'Not inspected'
    with pytest.raises(ValueError):
        PositionUpdate(tmax_c=float('inf'))
