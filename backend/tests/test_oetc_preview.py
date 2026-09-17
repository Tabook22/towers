"""The report form's live preview (Section 1 of the Reports page) — see routers/reports.
oetc_report_preview. Must count exactly the same things the real report generation would, so the
numbers shown before generating never drift from what actually comes out."""
import datetime as dt

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Position, Team, Tower, User, Visit
from app.routers.reports import oetc_report_preview


def _engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine


def _seed(db: Session):
    team = Team(name="Alpha")
    tower_a = Tower(tower_id="T-1", area="Ashoor-Saada")
    tower_b = Tower(tower_id="T-2", area="Ashoor-Saada")
    db.add_all([team, tower_a, tower_b])
    db.flush()
    tower_a.assigned_team_id = team.id
    tower_b.assigned_team_id = team.id

    visit_a = Visit(tower_id=tower_a.id, team_id=team.id, inspection_date=dt.date(2026, 9, 1))
    visit_b = Visit(tower_id=tower_b.id, team_id=team.id, inspection_date=dt.date(2026, 9, 2))
    db.add_all([visit_a, visit_b])
    db.flush()

    # visit_a: one real finding, flagged as a hotspot; one untouched slot (no direction/photo).
    db.add_all(
        [
            Position(visit_id=visit_a.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor", hotspot="Yes"),
            Position(visit_id=visit_a.id, ohl="OHL1", phase="Y", string="S1"),
            # visit_b: one real finding, not a hotspot.
            Position(visit_id=visit_b.id, ohl="OHL1", phase="R", string="S1", direction="Saada", hotspot="No"),
        ]
    )
    db.commit()
    return team, tower_a, tower_b


def test_preview_counts_match_what_the_real_report_would_include():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        result = oetc_report_preview(
            start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), team_id=team.id, db=db, user=admin,
        )
        assert result.ok is True
        assert result.team_count == 1
        assert result.tower_count == 2
        assert result.visit_count == 2
        assert result.position_count == 2  # the untouched slot on visit_a is correctly excluded
        assert result.hotspot_count == 1


def test_preview_by_tower_alone_resolves_the_team_and_scopes_down():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        result = oetc_report_preview(
            start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), tower_id=tower_a.id, db=db, user=admin,
        )
        assert result.ok is True
        assert result.tower_count == 1
        assert result.visit_count == 1
        assert result.position_count == 1
        assert result.hotspot_count == 1


def test_preview_by_tower_resolves_the_team_from_the_visit_when_the_tower_is_unassigned():
    """Matches the real bug report: a tower with no (or a stale) catalog assignment, but a real
    visit — the preview must find it via the visit's own team, not just Tower.assigned_team_id."""
    engine = _engine()
    with Session(engine) as db:
        team = Team(name="Alpha")
        unassigned = Tower(tower_id="T-9", area="Ashoor-Saada")
        db.add_all([team, unassigned])
        db.flush()
        visit = Visit(tower_id=unassigned.id, team_id=team.id, inspection_date=dt.date(2026, 9, 5), mission_status="completed")
        db.add(visit)
        db.flush()
        db.add(Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor"))
        db.commit()
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        result = oetc_report_preview(
            start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), tower_id=unassigned.id, db=db, user=admin,
        )
        assert result.ok is True
        assert result.visit_count == 1
        assert result.position_count == 1


def test_preview_by_line_matches_area_scope():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        result = oetc_report_preview(
            start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), area="Ashoor-Saada", db=db, user=admin,
        )
        assert result.ok is True
        assert result.tower_count == 2
        assert result.position_count == 2


def test_preview_reports_no_match_clearly_instead_of_erroring():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        result = oetc_report_preview(
            start_date=dt.date(2020, 1, 1), end_date=dt.date(2020, 1, 31), team_id=team.id, db=db, user=admin,
        )
        assert result.ok is False
        assert result.visit_count == 0
        assert result.message


def test_preview_scopes_down_for_a_team_leader_even_on_a_wider_query():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        other_team = Team(name="Bravo")
        other_tower = Tower(tower_id="T-3", area="Ashoor-Saada", assigned_team_id=None)
        db.add_all([other_team, other_tower])
        db.flush()
        other_tower.assigned_team_id = other_team.id
        other_visit = Visit(tower_id=other_tower.id, team_id=other_team.id, inspection_date=dt.date(2026, 9, 3))
        db.add(other_visit)
        db.flush()
        db.add(Position(visit_id=other_visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor"))
        db.commit()

        leader = User(username="lead-alpha", role="team_leader", team_id=team.id, hashed_password="x")
        db.add(leader)
        db.commit()

        # Even asking for the whole line (both teams work "Ashoor-Saada"), a team_leader only ever
        # sees their own team's slice of it — same wall every other team-scoped endpoint enforces.
        result = oetc_report_preview(
            start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), area="Ashoor-Saada", db=db, user=leader,
        )
        assert result.team_count == 1
        assert result.tower_count == 2  # tower_a + tower_b, not tower_3 (Bravo's)
