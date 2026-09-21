"""A Tension-type tower can carry the same OHL/phase/string out toward more than one line
Direction — the first direction reuses the matching baseline slot (unchanged PATCH flow), and any
further direction for that same slot needs its own extra row, added via
POST /api/visits/{visit_id}/positions (see routers/visits.py's add_extra_position and
models.Position's unique constraint, now (visit_id, ohl, phase, string, direction))."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.database import Base
from app.migrations import rebuild_positions_table_for_multi_direction_support
from app.models import Position, Team, Tower, User, UserRole, Visit
from app.routers import visits
from app.schemas import PositionCreate


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _admin_user() -> User:
    return User(id=1, username="admin", role="admin", is_super_admin=True)


def _make_visit(db, team_id: int | None = None) -> Visit:
    tower = Tower(tower_id="ARSD 92", voltage="132 kV", area="Ashoor-Saada")
    db.add(tower)
    db.flush()
    visit = Visit(tower_id=tower.id, team_id=team_id)
    db.add(visit)
    db.commit()
    db.refresh(visit)
    return visit


def test_add_extra_position_creates_a_second_direction_for_the_same_slot(db):
    visit = _make_visit(db)
    baseline = Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor")
    db.add(baseline)
    db.commit()

    out = visits.add_extra_position(
        visit_id=visit.id,
        payload=PositionCreate(ohl="OHL1", phase="R", string="S1", direction="Saada", mount_type="Tension"),
        db=db,
        user=_admin_user(),
    )
    assert out.ohl == "OHL1"
    assert out.phase == "R"
    assert out.string == "S1"
    assert out.direction == "Saada"
    assert out.mount_type == "Tension"
    assert len(out.images) == 4  # same 4-image-type baseline every position gets

    rows = db.query(Position).filter(Position.visit_id == visit.id, Position.ohl == "OHL1", Position.phase == "R", Position.string == "S1").all()
    assert {p.direction for p in rows} == {"Ashoor", "Saada"}


def test_add_extra_position_rejects_an_exact_duplicate(db):
    visit = _make_visit(db)
    db.add(Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor"))
    db.commit()

    with pytest.raises(HTTPException) as exc:
        visits.add_extra_position(
            visit_id=visit.id,
            payload=PositionCreate(ohl="OHL1", phase="R", string="S1", direction="Ashoor"),
            db=db,
            user=_admin_user(),
        )
    assert exc.value.status_code == 400


def test_add_extra_position_enforces_team_access(db):
    team_a = Team(name="Alpha")
    team_b = Team(name="Beta")
    db.add_all([team_a, team_b])
    db.commit()
    visit = _make_visit(db, team_id=team_a.id)
    leader_b = User(id=7, username="leader_b", role=UserRole.TEAM_LEADER.value, team_id=team_b.id)

    with pytest.raises(HTTPException) as exc:
        visits.add_extra_position(
            visit_id=visit.id,
            payload=PositionCreate(ohl="OHL1", phase="R", string="S1", direction="Saada"),
            db=db,
            user=leader_b,
        )
    assert exc.value.status_code == 403


def test_position_create_rejects_an_invalid_direction():
    with pytest.raises(ValueError):
        PositionCreate(ohl="OHL1", phase="R", string="S1", direction="Nowhere")


def test_rebuild_positions_migration_loosens_the_unique_constraint_and_keeps_data(tmp_path):
    db_path = tmp_path / "old_schema.db"
    engine = create_engine(f"sqlite:///{db_path}")

    # Build the OLD-shaped table by hand (constraint without `direction`), mirroring the schema
    # this app shipped with before Tension towers needed more than one direction per slot.
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE positions (
                    id INTEGER PRIMARY KEY,
                    visit_id INTEGER NOT NULL,
                    ohl VARCHAR(10) NOT NULL,
                    phase VARCHAR(5) NOT NULL,
                    string VARCHAR(5) NOT NULL,
                    direction VARCHAR(5),
                    installed BOOLEAN DEFAULT 1,
                    screening_result VARCHAR(40) DEFAULT 'Not inspected',
                    position_code VARCHAR(160),
                    created_at DATETIME,
                    updated_at DATETIME,
                    CONSTRAINT uq_position_slot UNIQUE (visit_id, ohl, phase, string)
                )
                """
            )
        )
        conn.execute(
            text(
                "INSERT INTO positions (id, visit_id, ohl, phase, string, direction, created_at, updated_at) "
                "VALUES (1, 1, 'OHL1', 'R', 'S1', 'Ashoor', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
            )
        )

    rebuild_positions_table_for_multi_direction_support(engine)

    inspector = inspect(engine)
    unique_cols = set()
    for uc in inspector.get_unique_constraints("positions"):
        unique_cols |= set(uc.get("column_names") or [])
    assert "direction" in unique_cols

    with engine.begin() as conn:
        row = conn.execute(text("SELECT visit_id, ohl, phase, string, direction FROM positions WHERE id = 1")).fetchone()
        assert row == (1, "OHL1", "R", "S1", "Ashoor")
        # The new constraint accepts a second direction for the same slot — proves the rebuild
        # actually changed the enforced constraint, not just added an unused column.
        conn.execute(
            text(
                "INSERT INTO positions (id, visit_id, ohl, phase, string, direction, installed, screening_result, created_at, updated_at) "
                "VALUES (2, 1, 'OHL1', 'R', 'S1', 'Saada', 1, 'Not inspected', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
            )
        )


def test_rebuild_positions_migration_is_a_safe_noop_on_a_fresh_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    rebuild_positions_table_for_multi_direction_support(engine)  # must not raise
    inspector = inspect(engine)
    assert "positions" in inspector.get_table_names()
