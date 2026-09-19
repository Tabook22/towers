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
    # Every image slot defaults to PENDING CAPTURE, but a missing photo never blocks the visit
    # status by itself — only unscreened positions do.
    assert r["images_pending"] == 48
    assert r["visit_status"] == "Inspection incomplete"


def test_normal_screening_does_not_require_close_images(db):
    visit = make_visit(db)
    pos = visit.positions[0]
    pos.direction = "Ashoor"
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
    pos.direction = "Ashoor"
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
    assert r["images_pending"] >= 1  # PENDING CAPTURE, no files uploaded yet — informational only
    assert r["visit_status"] == "Inspection incomplete"  # 11 of 12 positions still unscreened


def test_fully_screened_visit_is_ready_for_review_even_with_photos_missing(db):
    """A tower is never blocked from "Ready for review" just because photo evidence is
    short of the full checklist — only unscreened positions hold it back."""
    visit = make_visit(db)
    for pos in visit.positions:
        pos.direction = "Ashoor"
        pos.screening_result = "Normal"
        refresh_position_codes(pos)
    db.commit()
    db.refresh(visit)

    r = visit_rollup(visit)
    assert r["screened"] == r["installed"] == 12
    assert r["images_pending"] > 0
    assert r["visit_status"] == "Ready for review"


def test_recording_a_hotspot_determination_auto_fills_screening_result(db):
    """A position where the inspector recorded Hotspot=Yes (and presumably temps/evidence) but
    never separately touched the Screening result dropdown must not be left reading "Not
    inspected" — that's real inspection data on file, and it should count as screened."""
    visit = make_visit(db)
    pos = visit.positions[0]
    pos.direction = "Ashoor"
    pos.hotspot = "Yes"  # screening_result deliberately left at its "Not inspected" default
    db.flush()
    refresh_position_codes(pos)
    db.commit()

    assert pos.screening_result == "Hotspot detected"


def test_hotspot_no_auto_fills_screening_result_as_normal(db):
    visit = make_visit(db)
    pos = visit.positions[0]
    pos.direction = "Ashoor"
    pos.hotspot = "No"
    db.flush()
    refresh_position_codes(pos)
    db.commit()

    assert pos.screening_result == "Normal"


def test_hotspot_unconfirmed_auto_fills_screening_result_as_inconclusive(db):
    visit = make_visit(db)
    pos = visit.positions[0]
    pos.direction = "Ashoor"
    pos.hotspot = "Unconfirmed"
    db.flush()
    refresh_position_codes(pos)
    db.commit()

    assert pos.screening_result == "Inconclusive"


def test_auto_fill_never_overwrites_a_screening_result_the_inspector_already_picked(db):
    visit = make_visit(db)
    pos = visit.positions[0]
    pos.direction = "Ashoor"
    pos.screening_result = "Reinspection required"
    pos.hotspot = "Yes"
    db.flush()
    refresh_position_codes(pos)
    db.commit()

    assert pos.screening_result == "Reinspection required"


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
