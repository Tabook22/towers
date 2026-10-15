import pytest
from fastapi import HTTPException
from app.models import User, IMAGE_TYPE_CHOICES
from app.routers.images import set_evidence_requirement, EvidenceRequirement
from app.services.codes import _apply_default_evidence_status
from app.services.tower_map_status import tower_map_status
from app.services.rollup import visit_rollup
from tests.test_tower_reconciliation import data, visit, image


def test_exempt_restore_recapture_and_history_preserve_file(data):
    db, a, b, towers, admin = data
    v, p = visit(db, a, towers[0])
    img = image(db, p); img.evidence_status = 'RECAPTURE REQUIRED'; db.commit()
    original = img.file_path
    set_evidence_requirement(img.id, EvidenceRequirement(required=False, reason='Close image not needed'), db, admin)
    assert img.exemption_reason == 'Close image not needed'
    assert img.exemption_by == admin.username
    assert img.file_path == original
    set_evidence_requirement(img.id, EvidenceRequirement(required=False, reason='Close image not needed'), db, admin)
    assert len(img.exemption_history) == 1
    set_evidence_requirement(img.id, EvidenceRequirement(required=True), db, admin)
    assert img.evidence_status == 'RECAPTURE REQUIRED'
    assert img.exemption_reason is None
    assert len(img.exemption_history) == 2
    assert img.file_path == original


def test_documented_exemptions_remove_pending_and_map_question(data):
    db, a, b, towers, admin = data
    v, p = visit(db, a, towers[0])
    for kind in IMAGE_TYPE_CHOICES:
        img = image(db, p, kind); img.file_path = None; img.evidence_status = 'NOT REQUIRED'
    db.commit(); db.expire_all()
    assert visit_rollup(v)['images_pending'] == 4
    assert tower_map_status(db, [towers[0].id])[towers[0].id]['map_evidence_missing']
    for img in list(p.images):
        set_evidence_requirement(img.id, EvidenceRequirement(required=False, reason='Approved field exception'), db, admin)
        _apply_default_evidence_status(p, img)
        assert img.evidence_status == 'NOT REQUIRED'
    assert visit_rollup(v)['images_pending'] == 0
    assert not tower_map_status(db, [towers[0].id])[towers[0].id]['map_evidence_missing']
    from app.services.tower_reconciliation import reconcile_towers
    # Exemptions do not fabricate uploaded evidence or double-count a tower as red and green.
    assert not reconcile_towers(db, [a.id])['teams'][0]['towers'][0]['screening_and_evidence_ready']


def test_reason_and_role_are_required(data):
    db, a, b, towers, admin = data
    v, p = visit(db, a, towers[0]); img = image(db, p)
    with pytest.raises(HTTPException) as error:
        set_evidence_requirement(img.id, EvidenceRequirement(required=False, reason=' '), db, admin)
    assert error.value.status_code == 422
    for role in ('client', 'team_member'):
        with pytest.raises(HTTPException) as error:
            set_evidence_requirement(img.id, EvidenceRequirement(required=False, reason='Optional'), db, User(role=role))
        assert error.value.status_code == 403
