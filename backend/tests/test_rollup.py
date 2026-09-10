"""Verifies the dashboard roll-up math reproduces the workbook's 'Overall Summary' formulas."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import IMAGE_TYPE_CHOICES, OHL_CHOICES, PHASE_CHOICES, STRING_CHOICES, Image, Position, Tower, Visit
from app.services.codes import refresh_position_codes
from app.services.rollup import visit_rollup


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def make_visit(db):
    tower = Tower(tower_id="ARSD 92", voltage="132 kV", area="Dufar")
    db.add(tower)
    db.flush()
    visit = Visit(tower_id=tower.id)
    db.add(visit)
    db.flush()
    for ohl in OHL_CHOICES:
        for phase in PHASE_CHOICES:
            for string in STRING_CHOICES:
                pos = Position(visit_id=visit.id, ohl=ohl, phase=phase, string=string)
                db.add(pos)
                db.flush()
                for img_type in IMAGE_TYPE_CHOICES:
                    db.add(Image(position_id=pos.id, image_type=img_type, evidence_status="NOT REQUIRED"))
                db.flush()
                pos.visit = visit
                refresh_position_codes(pos)
    db.commit()
    db.refresh(visit)
    return visit


def test_fresh_visit_has_12_positions_all_not_inspected(db):
    visit = make_visit(db)
    r = visit_rollup(visit)
    assert r["possible_positions"] == 12
    assert r["installed"] == 12  # default installed=True
    assert r["screened"] == 0  # still "Not inspected"
    assert r["hotspots"] == 0
    # Every image slot defaults to PENDING CAPTURE, so evidence takes priority in the status,
    # matching the workbook's IF(images_pending>0, "Evidence incomplete", ...) precedence.
    assert r["visit_status"] == "Evidence incomplete"


def test_normal_screening_does_not_require_close_images(db):
    visit = make_visit(db)
    pos = visit.positions[0]
    pos.direction = "EN"
    pos.screening_result = "Normal"
    db.flush()
    refresh_position_codes(pos)
    db.commit()

    by_type = {i.image_type: i.evidence_status for i in pos.images}
    assert by_type["TH Close"] == "NOT REQUIRED"
    assert by_type["RGB Close"] == "NOT REQUIRED"
    assert by_type["TH Full"] == "PENDING CAPTURE"
    assert by_type["RGB Full"] == "PENDING CAPTURE"


def test_hotspot_position_counts_and_visit_status(db):
    visit = make_visit(db)
    pos = visit.positions[0]
    pos.direction = "EN"
    pos.screening_result = "Hotspot detected"
    pos.hotspot = "Yes"
    db.flush()
    refresh_position_codes(pos)
    for img in pos.images[1:]:
        db.delete(img)
    db.commit()
    db.refresh(visit)

    r = visit_rollup(visit)
    assert r["hotspots"] == 1
    assert r["screened"] == 1
    assert r["images_pending"] >= 1  # PENDING CAPTURE, no files uploaded yet
    assert r["visit_status"] == "Evidence incomplete"


def test_completion_pct_is_zero_when_nothing_installed(db):
    visit = make_visit(db)
    for pos in visit.positions:
        pos.installed = False
        pos.screening_result = "Not installed"
        refresh_position_codes(pos)
    db.commit()
    db.refresh(visit)

    r = visit_rollup(visit)
    assert r["installed"] == 0
    assert r["completion_pct"] == 0.0
