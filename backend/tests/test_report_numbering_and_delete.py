"""Auto-generated report numbers (team name + creation date + a random 4-digit suffix, see
services/oetc_report.generate_report_number) and the ability to delete a generated report
(routers/reports.delete_oetc_line_report) — a report that went out with wrong or stale information
can now be removed and regenerated, instead of living forever in the Reports Library."""
import datetime as dt
import re

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import LineInspectionReport, ReportComment, ReportImage, Team, Tower, User, Visit
from app.routers.reports import delete_oetc_line_report, oetc_area_report, oetc_line_report
from app.schemas import LineInspectionReportRequest, OetcAreaReportRequest
from app.services.oetc_report import generate_report_number

NUMBER_RE = re.compile(r"^[A-Za-z0-9]+-\d{8}-\d{4}$")


@pytest.fixture(autouse=True)
def _isolated_reports_dir(tmp_path, monkeypatch):
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "reports_dir", tmp_path / "reports")


def _engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine


def _seed(db: Session, team_name: str = "Ashoor Alpha"):
    team = Team(name=team_name)
    tower = Tower(tower_id="T-1", voltage="132")
    db.add_all([team, tower])
    db.flush()
    tower.assigned_team_id = team.id
    visit = Visit(tower_id=tower.id, team_id=team.id, inspection_date=dt.date(2026, 9, 1))
    db.add(visit)
    db.commit()
    from app.models import Position

    db.add(Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor", installed=True))
    db.commit()
    return team, tower


def _admin() -> User:
    return User(id=1, username="admin", role="admin", is_super_admin=True, hashed_password="x")


def test_generate_report_number_matches_team_date_random4_format():
    engine = _engine()
    with Session(engine) as db:
        number = generate_report_number(db, "Ashoor Alpha", dt.datetime(2026, 9, 23, 10, 0, 0))
    assert NUMBER_RE.match(number), number
    assert number.startswith("AshoorAlpha-20260923-")


def test_generate_report_number_is_unique_against_existing_rows():
    engine = _engine()
    with Session(engine) as db:
        team, _tower = _seed(db)
        # Occupy every number for this team+day except one, forcing the generator to keep retrying.
        taken = {f"AshoorAlpha-20260923-{n:04d}" for n in range(1000, 10000)}
        taken.discard("AshoorAlpha-20260923-9999")
        db.add_all(LineInspectionReport(team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 1), report_number=n) for n in taken)
        db.commit()
        number = generate_report_number(db, "Ashoor Alpha", dt.datetime(2026, 9, 23))
    assert number == "AshoorAlpha-20260923-9999"


def test_generate_report_number_respects_the_exclude_set():
    engine = _engine()
    with Session(engine) as db:
        candidates = {f"Team-20260101-{n:04d}" for n in range(1000, 10000)}
        candidates.discard("Team-20260101-5555")
        number = generate_report_number(db, "Team", dt.datetime(2026, 1, 1), exclude=candidates)
    assert number == "Team-20260101-5555"


def test_oetc_line_report_auto_generates_a_number_when_none_given():
    engine = _engine()
    with Session(engine) as db:
        team, tower = _seed(db)
        admin = _admin()
        db.add(admin)
        db.commit()
        payload = LineInspectionReportRequest(
            team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30)
        )
        oetc_line_report(payload=payload, db=db, user=admin)
        record = db.query(LineInspectionReport).one()
        assert NUMBER_RE.match(record.report_number), record.report_number
        assert record.report_number.startswith("AshoorAlpha-")


def test_oetc_line_report_still_honors_an_explicit_number():
    engine = _engine()
    with Session(engine) as db:
        team, tower = _seed(db)
        admin = _admin()
        db.add(admin)
        db.commit()
        payload = LineInspectionReportRequest(
            team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), report_number="CUSTOM-001"
        )
        oetc_line_report(payload=payload, db=db, user=admin)
        record = db.query(LineInspectionReport).one()
        assert record.report_number == "CUSTOM-001"


def test_oetc_area_report_gives_each_team_block_its_own_distinct_auto_number():
    engine = _engine()
    with Session(engine) as db:
        from app.models import Area

        db.add(Area(name="Ashoor-Saada"))
        team1, tower1 = _seed(db, "Team One")
        tower1.area = "Ashoor-Saada"
        team2 = Team(name="Team Two")
        tower2 = Tower(tower_id="T-2", voltage="132", area="Ashoor-Saada")
        db.add(team2)
        db.add(tower2)
        db.flush()
        tower2.assigned_team_id = team2.id
        visit2 = Visit(tower_id=tower2.id, team_id=team2.id, inspection_date=dt.date(2026, 9, 1))
        db.add(visit2)
        db.commit()
        from app.models import Position

        db.add(Position(visit_id=visit2.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor", installed=True))
        db.commit()

        admin = _admin()
        db.add(admin)
        db.commit()

        payload = OetcAreaReportRequest(area="Ashoor-Saada", start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30))
        oetc_area_report(payload=payload, db=db, user=admin)

        records = db.query(LineInspectionReport).all()
        assert len(records) == 2
        numbers = {r.report_number for r in records}
        assert len(numbers) == 2
        for n in numbers:
            assert NUMBER_RE.match(n), n
        assert any(n.startswith("TeamOne-") for n in numbers)
        assert any(n.startswith("TeamTwo-") for n in numbers)


def test_delete_report_removes_row_images_comments_and_file():
    engine = _engine()
    with Session(engine) as db:
        team, tower = _seed(db)
        admin = _admin()
        db.add(admin)
        db.commit()
        payload = LineInspectionReportRequest(
            team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30)
        )
        oetc_line_report(payload=payload, db=db, user=admin)
        record = db.query(LineInspectionReport).one()
        report_id = record.id
        from app import config as config_module

        saved_path = config_module.settings.reports_dir / record.file_path
        assert saved_path.exists()

        db.add(ReportComment(report_id=report_id, author_id=admin.id, author_name="Admin", author_role="admin", body="hi"))
        db.commit()

        delete_oetc_line_report(report_id, db=db, user=admin)

        assert db.get(LineInspectionReport, report_id) is None
        assert db.query(ReportComment).filter_by(report_id=report_id).count() == 0
        assert db.query(ReportImage).filter_by(report_id=report_id).count() == 0
        assert not saved_path.exists()


def test_delete_report_404s_for_a_missing_report():
    engine = _engine()
    with Session(engine) as db:
        admin = _admin()
        db.add(admin)
        db.commit()
        with pytest.raises(HTTPException) as exc:
            delete_oetc_line_report(999, db=db, user=admin)
        assert exc.value.status_code == 404


def test_restricted_admin_without_full_generate_reports_cannot_delete():
    engine = _engine()
    with Session(engine) as db:
        team, tower = _seed(db)
        super_admin = _admin()
        db.add(super_admin)
        db.commit()
        payload = LineInspectionReportRequest(team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30))
        oetc_line_report(payload=payload, db=db, user=super_admin)
        record = db.query(LineInspectionReport).one()

        restricted = User(id=2, username="ltd", hashed_password="x", role="admin", is_super_admin=False, permissions_csv="generate_reports:add")
        db.add(restricted)
        db.commit()
        with pytest.raises(HTTPException) as exc:
            delete_oetc_line_report(record.id, db=db, user=restricted)
        assert exc.value.status_code == 403


def test_restricted_admin_with_full_generate_reports_can_delete():
    engine = _engine()
    with Session(engine) as db:
        team, tower = _seed(db)
        super_admin = _admin()
        db.add(super_admin)
        db.commit()
        payload = LineInspectionReportRequest(team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30))
        oetc_line_report(payload=payload, db=db, user=super_admin)
        record = db.query(LineInspectionReport).one()

        restricted = User(id=3, username="full_ltd", hashed_password="x", role="admin", is_super_admin=False, permissions_csv="generate_reports")
        db.add(restricted)
        db.commit()
        delete_oetc_line_report(record.id, db=db, user=restricted)
        assert db.get(LineInspectionReport, record.id) is None


def test_team_leader_can_delete_their_own_teams_report_but_not_anothers():
    engine = _engine()
    with Session(engine) as db:
        team_a, tower_a = _seed(db, "Team A")
        team_b = Team(name="Team B")
        db.add(team_b)
        db.commit()
        admin = _admin()
        db.add(admin)
        db.commit()
        payload = LineInspectionReportRequest(team_id=team_a.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30))
        oetc_line_report(payload=payload, db=db, user=admin)
        record = db.query(LineInspectionReport).one()

        other_leader = User(id=4, username="leader_b", hashed_password="x", role="team_leader", team_id=team_b.id)
        db.add(other_leader)
        db.commit()
        with pytest.raises(HTTPException) as exc:
            delete_oetc_line_report(record.id, db=db, user=other_leader)
        assert exc.value.status_code == 403

        own_leader = User(id=5, username="leader_a", hashed_password="x", role="team_leader", team_id=team_a.id)
        db.add(own_leader)
        db.commit()
        delete_oetc_line_report(record.id, db=db, user=own_leader)
        assert db.get(LineInspectionReport, record.id) is None


def test_team_member_and_client_cannot_delete_reports():
    engine = _engine()
    with Session(engine) as db:
        team, tower = _seed(db)
        admin = _admin()
        db.add(admin)
        db.commit()
        payload = LineInspectionReportRequest(team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30))
        oetc_line_report(payload=payload, db=db, user=admin)
        record = db.query(LineInspectionReport).one()

        for role in ("team_member", "client"):
            actor = User(username=f"u_{role}", hashed_password="x", role=role, team_id=team.id if role == "team_member" else None)
            db.add(actor)
            db.commit()
            with pytest.raises(HTTPException) as exc:
                delete_oetc_line_report(record.id, db=db, user=actor)
            assert exc.value.status_code == 403
