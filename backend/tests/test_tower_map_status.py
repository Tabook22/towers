import datetime as dt
from app.models import IMAGE_TYPE_CHOICES, Visit, VisitPhoto
from app.services.tower_map_status import tower_map_status
from tests.test_tower_reconciliation import data, visit, image


def test_no_tick_for_plan_tick_for_screening_question_for_missing_images(data):
    db, a, b, towers, _ = data
    v, p = visit(db, a, towers[0], screened=False)
    assert tower_map_status(db, [towers[0].id]) == {}
    p.screening_result = 'Normal'; db.flush()
    assert tower_map_status(db, [towers[0].id])[towers[0].id] == dict(map_visit_recorded=True, map_evidence_missing=True)
    for category in IMAGE_TYPE_CHOICES: image(db, p, category)
    assert tower_map_status(db, [towers[0].id])[towers[0].id]['map_evidence_missing'] is False
    p.images[0].evidence_status = 'RECAPTURE REQUIRED'; db.flush()
    assert tower_map_status(db, [towers[0].id])[towers[0].id]['map_evidence_missing'] is True


def test_completed_without_images_and_history_survives_new_plan(data):
    db, a, b, towers, _ = data
    v, p = visit(db, a, towers[0], screened=False)
    v.mission_status = 'completed'; db.flush()
    db.add(Visit(team_id=b.id, tower_id=towers[0].id, inspection_date=dt.date(2026, 10, 10))); db.flush()
    assert tower_map_status(db, [towers[0].id])[towers[0].id]['map_evidence_missing'] is True
    assert tower_map_status(db, [towers[0].id], team_id=b.id) == {}


def test_field_photo_counts_but_no_layout_is_not_complete(data):
    db, a, b, towers, _ = data
    v, p = visit(db, a, towers[0], screened=False)
    db.add(VisitPhoto(visit_id=v.id, file_path='field.jpg')); db.flush()
    assert tower_map_status(db, [towers[0].id])[towers[0].id]['map_visit_recorded']
    assert tower_map_status(db, [towers[0].id])[towers[0].id]['map_evidence_missing']
