"""refresh_position_codes() must only recompute the *baseline* (sequence == 1) image's code per
type — an extra gallery image (sequence > 1, added via POST /api/positions/{id}/images) of the same
type must never be mistaken for the baseline, since images.image_code is unique and overwriting an
extra's code with the bare (un-suffixed) base code collides with the real baseline row's code."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Image, Position, Tower, Visit
from app.services.codes import refresh_position_codes


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _position_with_extra_image(db) -> Position:
    tower = Tower(tower_id="ARSD 92", voltage="132 kV", area="Ashoor-Saada")
    db.add(tower)
    db.flush()
    visit = Visit(tower_id=tower.id)
    db.add(visit)
    db.flush()
    pos = Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor")
    db.add(pos)
    db.flush()
    # The 4-type baseline (sequence 1) plus one extra "TH Full" gallery shot (sequence 2) — mirrors
    # what routers/positions.py's add_extra_image() creates.
    baseline = Image(position_id=pos.id, image_type="TH Full", sequence=1)
    extra = Image(position_id=pos.id, image_type="TH Full", sequence=2)
    db.add_all([baseline, extra])
    db.commit()
    db.refresh(pos)
    pos.visit = visit
    return pos


def test_baseline_and_extra_image_of_the_same_type_get_distinct_codes(db):
    pos = _position_with_extra_image(db)

    refresh_position_codes(pos)
    db.commit()

    by_seq = {img.sequence: img for img in pos.images if img.image_type == "TH Full"}
    assert by_seq[1].image_code == "ARSD92-OHL1-R-S1-Ashoor-0001"
    assert by_seq[2].image_code == "ARSD92-OHL1-R-S1-Ashoor-0001-2"
    assert by_seq[1].image_code != by_seq[2].image_code


def test_refresh_runs_repeatedly_without_a_unique_collision(db):
    """The original bug only ever surfaced on a *second* refresh (the first call happened to
    "fix" itself by luck of dict-iteration order) — call it several times to make sure."""
    pos = _position_with_extra_image(db)
    for _ in range(3):
        refresh_position_codes(pos)
        db.commit()  # would raise IntegrityError under the old code path


def test_extra_image_code_tracks_a_later_direction_change(db):
    pos = _position_with_extra_image(db)
    refresh_position_codes(pos)
    db.commit()

    pos.direction = "Saada"
    refresh_position_codes(pos)
    db.commit()

    baseline = next(img for img in pos.images if img.sequence == 1)
    extra = next(img for img in pos.images if img.sequence == 2)
    assert extra.image_code == f"{baseline.image_code}-2"
    assert "Saada" in extra.image_code
