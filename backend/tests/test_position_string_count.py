import pytest
from fastapi import HTTPException
from app.models import Position
from app.schemas import PositionCreate, PositionUpdate, PositionOut
from app.routers.visits import add_extra_position
from app.routers.positions import update_position
from app.services.oetc_report import _derived_tower_proximity
from tests.test_multi_direction_positions import db, _make_visit, _admin_user


@pytest.mark.parametrize('mount', ['Tension', 'Suspension'])
def test_mixed_phase_counts_create_save_edit_and_preserve_evidence(db, mount):
    visit = _make_visit(db)
    rows = []
    for phase, count, string in [('R', 'Single', 'S1'), ('Y', 'Double', 'S1'), ('Y', 'Double', 'S2')]:
        rows.append(add_extra_position(visit.id, PositionCreate(ohl='OHL1', phase=phase,
            string=string, direction='Ashoor', mount_type=mount, string_count=count), db, _admin_user()))
    red, outer, inner = rows
    red.images[0].file_path = 'preserved.jpg'
    red.inspector_notes = 'Keep the inspection notes'
    db.commit()
    image_ids = [image.id for image in red.images]
    update_position(red.id, PositionUpdate(string_count='Double', string='S2'), db, _admin_user())
    db.expire_all()
    saved = PositionOut.model_validate(db.get(Position, red.id))
    assert saved.string_count == 'Double' and saved.string == 'S2'
    assert saved.tower_proximity == 'Inner'
    assert [image.id for image in saved.images] == image_ids
    assert any(image.file_path == 'preserved.jpg' for image in saved.images)
    assert saved.inspector_notes == 'Keep the inspection notes'
    update_position(red.id, PositionUpdate(string_count='Single', string='S1'), db, _admin_user())
    assert red.string == 'S1' and red.tower_proximity is None
    assert outer.string_count == inner.string_count == 'Double'
    assert _derived_tower_proximity(outer) == 'Outer'
    assert _derived_tower_proximity(inner) == 'Inner'


def test_single_string_rejects_s2_on_create_and_update(db):
    with pytest.raises(ValueError):
        PositionCreate(ohl='OHL1', phase='R', string='S2', direction='Ashoor', string_count='Single')
    visit = _make_visit(db)
    pos = add_extra_position(visit.id, PositionCreate(ohl='OHL1', phase='R', string='S2',
        direction='Ashoor', string_count='Double'), db, _admin_user())
    with pytest.raises(HTTPException) as error:
        update_position(pos.id, PositionUpdate(string_count='Single'), db, _admin_user())
    assert error.value.status_code == 422
    assert pos.string_count == 'Double'


def test_edit_cannot_overwrite_an_existing_string_position(db):
    visit = _make_visit(db)
    rows = [add_extra_position(visit.id, PositionCreate(ohl='OHL1', phase='R', string=string,
        direction='Ashoor', string_count='Double'), db, _admin_user()) for string in ['S1', 'S2']]
    with pytest.raises(HTTPException) as error:
        update_position(rows[1].id, PositionUpdate(string_count='Single', string='S1'), db, _admin_user())
    assert error.value.status_code == 409
    assert rows[1].string == 'S2' and rows[1].string_count == 'Double'
    assert len(rows[0].images) == len(rows[1].images) == 4


def test_hidden_baseline_can_be_activated_with_string_count(db):
    visit = _make_visit(db)
    pos = Position(visit_id=visit.id, ohl='OHL1', phase='B', string='S1')
    db.add(pos); db.commit()
    update_position(pos.id, PositionUpdate(direction='Ashoor', mount_type='Suspension', string_count='Single'), db, _admin_user())
    db.expire_all()
    assert PositionOut.model_validate(db.get(Position, pos.id)).string_count == 'Single'


def test_legacy_configuration_does_not_block_unrelated_inspection_edits(db):
    visit = _make_visit(db)
    pos = Position(visit_id=visit.id, ohl='OHL1', phase='B', string='S2', string_count='Single')
    db.add(pos); db.commit()
    update_position(pos.id, PositionUpdate(inspector_notes='Preserve normal inspection editing'), db, _admin_user())
    assert pos.inspector_notes == 'Preserve normal inspection editing'
    with pytest.raises(HTTPException) as error:
        update_position(pos.id, PositionUpdate(string_count='Single'), db, _admin_user())
    assert error.value.status_code == 422
