"""The customer-facing "client" role and its reports/images portal:
- services/oetc_report.used_image_ids — the snapshot report-image linking relies on.
- routers/reports.py's oetc_line_report_images / update_oetc_line_report / history filters.
- routers/images.py's delete_image client gating.
- routers/auth.py's account-management boundary for the new role.
See app/client_guard.py (tested separately) for the HTTP-layer route allowlist."""
import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Image, LineInspectionReport, Position, ReportImage, Team, Tower, User, UserRole, Visit
from app.routers import auth as auth_router
from app.routers import images as images_router
from app.routers import reports as reports_router
from app.schemas import LineInspectionReportRequest, LineInspectionReportUpdate, UserCreate
from app.services.oetc_report import used_image_ids


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(autouse=True)
def _isolated_reports_dir(tmp_path, monkeypatch):
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "reports_dir", tmp_path / "reports")


def _admin() -> User:
    return User(id=1, username="admin", role="admin", is_super_admin=True, hashed_password="x")


def _client(can_edit=False, can_delete=False) -> User:
    return User(
        id=2,
        username="oetc_client",
        role=UserRole.CLIENT.value,
        hashed_password="x",
        can_edit_reports=can_edit,
        can_delete_report_images=can_delete,
    )


def _seed_visit_with_images(db) -> tuple[Team, Tower, Visit, Position]:
    team = Team(name="Alpha")
    tower = Tower(tower_id="T-1", voltage="132")
    db.add_all([team, tower])
    db.flush()
    tower.assigned_team_id = team.id
    visit = Visit(tower_id=tower.id, team_id=team.id, inspection_date=dt.date(2026, 9, 1))
    db.add(visit)
    db.flush()
    pos = Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor")
    db.add(pos)
    db.flush()
    img = Image(position_id=pos.id, image_type="TH Full", sequence=1, file_path="a.jpg")
    db.add(img)
    db.commit()
    return team, tower, visit, pos


def test_used_image_ids_only_counts_positions_with_activity_and_a_real_file():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team, tower, visit, pos = _seed_visit_with_images(db)
        # A second position with no activity at all — must be excluded.
        db.add(Position(visit_id=visit.id, ohl="OHL1", phase="Y", string="S1"))
        db.commit()

        ids = used_image_ids([visit])
        assert len(ids) == 1
        position_id, image_id, image_type = ids[0]
        assert position_id == pos.id
        assert image_type == "TH Full"


def test_generating_a_report_snapshots_its_images():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team, tower, visit, pos = _seed_visit_with_images(db)
        admin = _admin()
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="SNAP-0001",
        )
        reports_router.oetc_line_report(payload=payload, db=db, user=admin)

        record = db.query(LineInspectionReport).filter_by(report_number="SNAP-0001").one()
        assert record.report_type == "team"
        links = db.query(ReportImage).filter_by(report_id=record.id).all()
        assert len(links) == 1
        assert links[0].position_id == pos.id


def test_client_cannot_generate_a_report():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team, tower, visit, pos = _seed_visit_with_images(db)
        payload = LineInspectionReportRequest(
            team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), report_number="X-0001"
        )
        with pytest.raises(HTTPException) as exc:
            reports_router.oetc_line_report(payload=payload, db=db, user=_client())
        assert exc.value.status_code == 403


def test_client_sees_every_team_report_in_history_with_no_team_id_filter():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team_a, tower_a, visit_a, _ = _seed_visit_with_images(db)
        team_b = Team(name="Beta")
        tower_b = Tower(tower_id="T-2", voltage="132")
        db.add_all([team_b, tower_b])
        db.commit()
        db.add(
            LineInspectionReport(
                team_id=team_b.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 1), report_number="OTHER-0001"
            )
        )
        db.commit()
        admin = _admin()
        db.add(admin)
        db.commit()
        payload = LineInspectionReportRequest(
            team_id=team_a.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), report_number="MINE-0001"
        )
        reports_router.oetc_line_report(payload=payload, db=db, user=admin)

        out = reports_router.oetc_line_report_history(
            team_id=None, tower_id=None, report_type=None, line_sector=None, start_date=None, end_date=None, search=None,
            db=db, user=_client(),
        )
        numbers = {r.report_number for r in out}
        assert "MINE-0001" in numbers and "OTHER-0001" in numbers


def test_history_search_filters_by_report_number_substring():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team, tower, visit, pos = _seed_visit_with_images(db)
        admin = _admin()
        db.add(admin)
        db.commit()
        reports_router.oetc_line_report(
            payload=LineInspectionReportRequest(
                team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), report_number="ABC-0042"
            ),
            db=db,
            user=admin,
        )
        out = reports_router.oetc_line_report_history(
            team_id=None, tower_id=None, report_type=None, line_sector=None, start_date=None, end_date=None, search="0042",
            db=db, user=admin,
        )
        assert len(out) == 1
        assert out[0].report_number == "ABC-0042"
        assert out[0].image_count == 1


def test_report_images_endpoint_returns_the_snapshotted_images():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team, tower, visit, pos = _seed_visit_with_images(db)
        admin = _admin()
        db.add(admin)
        db.commit()
        reports_router.oetc_line_report(
            payload=LineInspectionReportRequest(
                team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), report_number="IMG-0001"
            ),
            db=db,
            user=admin,
        )
        record = db.query(LineInspectionReport).filter_by(report_number="IMG-0001").one()

        out = reports_router.oetc_line_report_images(report_id=record.id, db=db, user=_client())
        assert len(out) == 1
        assert out[0].tower_code == "T-1"
        assert out[0].position_id == pos.id


def test_report_images_endpoint_skips_a_snapshot_whose_image_was_since_deleted():
    """A snapshot row (ReportImage) is a permanent record that an image WAS part of a report — but
    the image itself can later be deleted (a non-baseline extra, see routers/images.py's
    delete_image). The endpoint must skip that now-dangling row rather than crash on it."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team, tower, visit, pos = _seed_visit_with_images(db)
        admin = _admin()
        db.add(admin)
        db.commit()
        reports_router.oetc_line_report(
            payload=LineInspectionReportRequest(
                team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), report_number="ORPHAN-0001"
            ),
            db=db,
            user=admin,
        )
        record = db.query(LineInspectionReport).filter_by(report_number="ORPHAN-0001").one()
        link = db.query(ReportImage).filter_by(report_id=record.id).one()
        db.delete(db.get(Image, link.image_id))
        db.commit()

        out = reports_router.oetc_line_report_images(report_id=record.id, db=db, user=admin)
        assert out == []  # no crash — just nothing left to show


def test_update_report_requires_client_flag():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team, tower, visit, pos = _seed_visit_with_images(db)
        admin = _admin()
        db.add(admin)
        db.commit()
        reports_router.oetc_line_report(
            payload=LineInspectionReportRequest(
                team_id=team.id, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), report_number="EDIT-0001"
            ),
            db=db,
            user=admin,
        )
        record = db.query(LineInspectionReport).filter_by(report_number="EDIT-0001").one()

        with pytest.raises(HTTPException) as exc:
            reports_router.update_oetc_line_report(
                report_id=record.id,
                payload=LineInspectionReportUpdate(additional_comments="client note"),
                db=db,
                user=_client(can_edit=False),
            )
        assert exc.value.status_code == 403

        out = reports_router.update_oetc_line_report(
            report_id=record.id,
            payload=LineInspectionReportUpdate(additional_comments="client note"),
            db=db,
            user=_client(can_edit=True),
        )
        assert out.additional_comments == "client note"


def test_delete_image_requires_client_flag_and_report_linkage():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team, tower, visit, pos = _seed_visit_with_images(db)
        # An extra (sequence > 1) image of the same type — the only kind delete_image ever allows.
        extra = Image(position_id=pos.id, image_type="TH Full", sequence=2, file_path=None)
        db.add(extra)
        db.commit()

        with pytest.raises(HTTPException) as exc:
            images_router.delete_image(image_id=extra.id, db=db, user=_client(can_delete=False))
        assert exc.value.status_code == 403

        # Flag granted, but this image was never linked to any report.
        with pytest.raises(HTTPException) as exc:
            images_router.delete_image(image_id=extra.id, db=db, user=_client(can_delete=True))
        assert exc.value.status_code == 403

        db.add(ReportImage(report_id=1, position_id=pos.id, image_id=extra.id, image_type="TH Full"))
        db.commit()
        images_router.delete_image(image_id=extra.id, db=db, user=_client(can_delete=True))
        assert db.get(Image, extra.id) is None


def test_only_a_super_admin_can_create_a_client_account():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        restricted_admin = User(
            id=1, username="restricted", role="admin", is_super_admin=False, permissions_csv="manage_users:full", hashed_password="x"
        )
        db.add(restricted_admin)
        db.commit()

        with pytest.raises(HTTPException) as exc:
            auth_router.create_user(
                payload=UserCreate(username="new_client", password="secret123", role=UserRole.CLIENT.value),
                db=db,
                actor=restricted_admin,
            )
        assert exc.value.status_code == 403

        super_admin = User(id=2, username="super", role="admin", is_super_admin=True, hashed_password="x")
        db.add(super_admin)
        db.commit()
        user = auth_router.create_user(
            payload=UserCreate(username="new_client2", password="secret123", role=UserRole.CLIENT.value, can_edit_reports=True),
            db=db,
            actor=super_admin,
        )
        assert user.role == UserRole.CLIENT.value
        assert user.can_edit_reports is True
        assert user.can_delete_report_images is False
