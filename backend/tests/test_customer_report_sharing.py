import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.database import Base
from app.models import User, Team, LineInspectionReport, Tower, Visit, Position, Image, ReportImage
from app.routers import auth, reports, images
from app.schemas import UserCreate, UserUpdate, ReportCommentCreate, LineInspectionReportUpdate
from app.migrations import add_missing_columns


@pytest.fixture
def db():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        team = Team(name='Crew')
        session.add(team)
        session.flush()
        for number in ('Selected', 'Private'):
            session.add(LineInspectionReport(team_id=team.id, report_number=number, start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 2)))
        session.commit()
        yield session


def client(ids=None):
    return User(username='customer', role='client', hashed_password='x', allowed_report_ids=ids, can_edit_reports=True)


def history(db, user):
    return reports.oetc_line_report_history(admin_only=False, team_id=None, tower_id=None, report_type=None, line_sector=None, start_date=None, end_date=None, search=None, db=db, user=user)


def test_only_selected_reports_visible_and_new_reports_private(db):
    customer = client([1])
    assert [r.id for r in history(db, customer)] == [1]
    db.add(LineInspectionReport(team_id=1, report_number='New', start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 2)))
    db.commit()
    assert [r.id for r in history(db, customer)] == [1]
    assert history(db, client([])) == []
    assert history(db, client(None)) == []
    assert [r.id for r in history(db, client([2]))] == [2]


@pytest.mark.parametrize('endpoint', [reports.report_inspection_data, reports.oetc_line_report_images, reports.oetc_line_report_comments, reports.download_saved_oetc_report, reports.redownload_oetc_line_report, reports.digital_report_layout, reports.report_inspection_data_pdf])
def test_unshared_report_direct_links_denied(db, endpoint):
    with pytest.raises(HTTPException) as error:
        endpoint(report_id=2, db=db, user=client([1]))
    assert error.value.status_code == 403


@pytest.mark.parametrize('endpoint', [reports.report_download_options, reports.prepare_report_pdf, reports.download_report_pdf])
def test_unshared_report_pdf_conversion_download_and_sizes_denied(db, endpoint):
    with pytest.raises(HTTPException) as error:
        endpoint(report_id=2, db=db, user=client([1]))
    assert error.value.status_code == 403


def test_unshared_report_comments_and_edits_denied_even_with_edit_flag(db):
    customer = client([1])
    for endpoint, payload in [(reports.add_oetc_line_report_comment, ReportCommentCreate(body='A note')), (reports.update_oetc_line_report, LineInspectionReportUpdate(additional_comments='Changed'))]:
        with pytest.raises(HTTPException) as error:
            endpoint(report_id=2, payload=payload, db=db, user=customer)
        assert error.value.status_code == 403
    customer.allowed_report_ids = []
    with pytest.raises(HTTPException):
        reports.report_inspection_data(1, db=db, user=customer)


def test_admin_sharing_is_validated_and_revocable(db):
    admin = User(username='admin', role='admin', hashed_password='x', is_super_admin=True)
    account = auth.create_user(UserCreate(username='customer', password='secret123', role='client', allowed_report_ids=[1, 1]), db=db, actor=admin)
    assert account.allowed_report_ids == [1]
    auth.update_user(account.id, UserUpdate(allowed_report_ids=[]), db=db, actor=admin)
    assert history(db, account) == []
    with pytest.raises(HTTPException) as error:
        auth.update_user(account.id, UserUpdate(allowed_report_ids=[9999]), db=db, actor=admin)
    assert error.value.status_code == 422
    assert account.allowed_report_ids == []
    with pytest.raises(HTTPException) as error:
        auth.update_user(account.id, UserUpdate(allowed_report_ids=[1]), db=db, actor=account)
    assert error.value.status_code == 403


def test_image_files_and_metadata_require_shared_report_link(db):
    tower = Tower(tower_id='T-1', voltage='132')
    db.add(tower)
    db.flush()
    visit = Visit(tower_id=tower.id, team_id=1, inspection_date=dt.date(2026, 9, 1))
    db.add(visit)
    db.flush()
    position = Position(visit_id=visit.id, ohl='OHL1', phase='R', string='S1')
    db.add(position)
    db.flush()
    image = Image(position_id=position.id, image_type='TH Full', sequence=1)
    db.add(image)
    db.flush()
    db.add(ReportImage(report_id=2, image_id=image.id, position_id=position.id, image_type='TH Full'))
    db.commit()
    with pytest.raises(HTTPException) as error:
        images.get_image(image.id, db=db, user=client([1]))
    assert error.value.status_code == 403
    assert images.get_image(image.id, db=db, user=client([2])).id == image.id
    with pytest.raises(HTTPException):
        images.get_image_thumbnail(image.id, db=db, user=client([]))


def test_customer_image_changes_denied_using_actual_account_role(db):
    from app.deps import get_current_user
    from app.security import create_access_token
    from starlette.requests import Request
    account = client([1])
    db.add(account)
    db.commit()
    token = create_access_token(subject=account.username, role='admin')
    for method in ('PATCH', 'POST', 'PUT', 'DELETE'):
        request = Request({'type': 'http', 'method': method, 'path': '/api/images/1', 'headers': [], 'query_string': b''})
        with pytest.raises(HTTPException) as error:
            get_current_user(token=token, token_query=None, db=db, request=request)
        assert error.value.status_code == 403


def test_legacy_database_migration_preserves_accounts_and_defaults_private():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(username='legacy', hashed_password='x', role='client'))
        db.commit()
    with engine.begin() as conn:
        conn.execute(text('ALTER TABLE users DROP COLUMN allowed_report_ids'))
    add_missing_columns(engine, Base)
    add_missing_columns(engine, Base)
    with Session(engine) as db:
        account = db.query(User).one()
        assert account.username == 'legacy'
        assert account.allowed_report_ids is None
        assert history(db, account) == []
