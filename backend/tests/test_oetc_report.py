"""Official ("OETC") report generation: a team's whole campaign by default, one particular tower's
visits only when tower_id is set alongside team_id, or tower_id alone ("report by tower" — the team
is resolved from the tower's current assignment so the caller doesn't have to know it) — see
routers/reports.oetc_line_report and services/oetc_report.build_oetc_line_report_context."""
import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import LineInspectionReport, Position, Team, Tower, User, Visit
from app.routers.reports import oetc_line_report, redownload_oetc_line_report
from app.schemas import LineInspectionReportRequest
from app.services.oetc_report import build_oetc_line_report_context


def _engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine


def _seed(db: Session):
    team = Team(name="Alpha")
    tower_a = Tower(tower_id="T-1", voltage="132")
    tower_b = Tower(tower_id="T-2", voltage="132")
    db.add_all([team, tower_a, tower_b])
    db.flush()
    tower_a.assigned_team_id = team.id
    tower_b.assigned_team_id = team.id

    visit_a = Visit(tower_id=tower_a.id, team_id=team.id, inspection_date=dt.date(2026, 9, 1))
    visit_b = Visit(tower_id=tower_b.id, team_id=team.id, inspection_date=dt.date(2026, 9, 2))
    db.add_all([visit_a, visit_b])
    db.flush()

    db.add_all(
        [
            Position(visit_id=visit_a.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor", installed=True),
            Position(visit_id=visit_b.id, ohl="OHL1", phase="Y", string="S1", direction="Ashoor", installed=True),
        ]
    )
    db.commit()
    return team, tower_a, tower_b


def test_tower_id_scopes_visits_to_that_tower_only():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            tower_id=tower_a.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0001",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)
        assert response.status_code == 200
        assert response.body  # a real .docx was rendered, not empty

        record = db.query(LineInspectionReport).one()
        assert record.tower_id == tower_a.id


def test_no_visits_for_that_tower_in_range_is_a_clear_400():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            tower_id=tower_a.id,
            start_date=dt.date(2026, 9, 2),
            end_date=dt.date(2026, 9, 2),  # only tower_b was visited that day
            report_number="TEST-0002",
        )
        with pytest.raises(HTTPException) as exc:
            oetc_line_report(payload=payload, db=db, user=admin)
        assert exc.value.status_code == 400
        assert "T-1" in exc.value.detail


def test_omitting_tower_id_covers_the_whole_team_as_before():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0003",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)
        assert response.status_code == 200

        record = db.query(LineInspectionReport).filter_by(report_number="TEST-0003").one()
        assert record.tower_id is None


def test_tower_id_alone_resolves_the_team_from_the_towers_assignment():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            tower_id=tower_a.id,  # no team_id — "report by tower" from the UI's single dropdown
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0005",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)
        assert response.status_code == 200

        record = db.query(LineInspectionReport).filter_by(report_number="TEST-0005").one()
        assert record.team_id == team.id
        assert record.tower_id == tower_a.id


def test_tower_id_alone_without_a_team_assignment_is_a_clear_400():
    engine = _engine()
    with Session(engine) as db:
        _team, _tower_a, _tower_b = _seed(db)
        unassigned = Tower(tower_id="T-3", voltage="132")
        db.add(unassigned)
        db.commit()
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            tower_id=unassigned.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0006",
        )
        with pytest.raises(HTTPException) as exc:
            oetc_line_report(payload=payload, db=db, user=admin)
        assert exc.value.status_code == 400
        assert "T-3" in exc.value.detail


def test_tower_id_alone_resolves_the_team_from_the_visit_when_the_tower_itself_is_unassigned():
    """The real-world bug this guards: a crew finishes inspecting a tower, but the tower's catalog
    assignment was since changed or cleared (or was never set — the visit can exist without a
    formal "assign to team" step). "Report by tower" must still find it via the visit's own
    team_id instead of hard-requiring Tower.assigned_team_id."""
    engine = _engine()
    with Session(engine) as db:
        team = Team(name="Alpha")
        unassigned = Tower(tower_id="T-9", voltage="132")  # never assigned in the catalog
        db.add_all([team, unassigned])
        db.flush()
        visit = Visit(tower_id=unassigned.id, team_id=team.id, inspection_date=dt.date(2026, 9, 5), mission_status="completed")
        db.add(visit)
        db.flush()
        db.add(Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor", installed=True))
        db.commit()
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            tower_id=unassigned.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0009",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)
        assert response.status_code == 200

        record = db.query(LineInspectionReport).filter_by(report_number="TEST-0009").one()
        assert record.team_id == team.id
        assert record.tower_id == unassigned.id


def test_tower_id_alone_still_enforces_the_team_leader_boundary():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, _tower_b = _seed(db)
        other_team = Team(name="Bravo")
        db.add(other_team)
        db.commit()
        leader = User(username="lead-bravo", role="team_leader", team_id=other_team.id, hashed_password="x")
        db.add(leader)
        db.commit()

        # tower_a is assigned to "Alpha", not this leader's own team "Bravo" — resolving the team
        # from the tower must not bypass the same team_leader wall every other report enforces.
        payload = LineInspectionReportRequest(
            tower_id=tower_a.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0008",
        )
        with pytest.raises(HTTPException) as exc:
            oetc_line_report(payload=payload, db=db, user=leader)
        assert exc.value.status_code == 403


def test_neither_team_nor_tower_is_rejected_by_the_schema():
    with pytest.raises(Exception):
        LineInspectionReportRequest(
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0007",
        )


def test_single_tower_context_names_the_tower_in_line_section_instead_of_the_mission_range():
    from docxtpl import DocxTemplate

    from app.services.oetc_report import TEMPLATE_PATH

    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        team.mission_from = "1"
        team.mission_to = "70"
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            tower_id=tower_a.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0004",
        )
        visits = [v for v in db.query(Visit).all() if v.tower_id == tower_a.id]
        tpl = DocxTemplate(str(TEMPLATE_PATH))
        context = build_oetc_line_report_context(tpl, team, visits, payload, tower=tower_a)
        assert context["line_section"] == "T-1"

        context_whole_team = build_oetc_line_report_context(tpl, team, db.query(Visit).all(), payload)
        assert context_whole_team["line_section"] == "1 to 70"


def test_redownload_reproduces_the_same_report_without_touching_the_uniqueness_check():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="REDOWNLOAD-0001",
            prepared_by="Ahmed",
        )
        oetc_line_report(payload=payload, db=db, user=admin)
        record = db.query(LineInspectionReport).filter_by(report_number="REDOWNLOAD-0001").one()

        # Calling redownload twice must not fail on "report number already used" — it never inserts
        # a new row, just re-renders from the one that's already there.
        response1 = redownload_oetc_line_report(report_id=record.id, db=db, user=admin)
        response2 = redownload_oetc_line_report(report_id=record.id, db=db, user=admin)
        assert response1.status_code == 200
        assert response2.status_code == 200
        assert response1.body and response2.body
        assert db.query(LineInspectionReport).count() == 1  # still just the one row


def test_redownload_is_blocked_for_a_team_leader_on_a_different_team():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        other_team = Team(name="Bravo")
        db.add(other_team)
        db.commit()
        admin = User(username="admin", role="admin", hashed_password="x")
        leader = User(username="lead-bravo", role="team_leader", team_id=other_team.id, hashed_password="x")
        db.add_all([admin, leader])
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="REDOWNLOAD-0002",
        )
        oetc_line_report(payload=payload, db=db, user=admin)
        record = db.query(LineInspectionReport).filter_by(report_number="REDOWNLOAD-0002").one()

        with pytest.raises(HTTPException) as exc:
            redownload_oetc_line_report(report_id=record.id, db=db, user=leader)
        assert exc.value.status_code == 403


def test_grouped_reports_persist_the_sign_off_fields_for_later_redownload():
    from app.routers.reports import _persist_blocks

    class FakeBlock:
        def __init__(self, team, visits, report_number):
            self.team = team
            self.visits = visits
            self.report_number = report_number

    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        visits = db.query(Visit).all()
        block = FakeBlock(team, visits, "GROUPED-0001")
        payload = LineInspectionReportRequest(
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="GROUPED-BASE",
            overall_condition="Acceptable",
            prepared_by="Ahmed",
        )
        _persist_blocks(db, [block], admin, payload)

        record = db.query(LineInspectionReport).filter_by(report_number="GROUPED-0001").one()
        assert record.overall_condition == "Acceptable"
        assert record.prepared_by == "Ahmed"
