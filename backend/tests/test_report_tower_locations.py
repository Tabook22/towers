import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import LineInspectionReport, Team, Tower, User
from app.routers.reports import report_tower_locations


@pytest.fixture
def report_scope():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team = Team(name='Crew')
        db.add(team); db.flush()
        shown = Tower(tower_id='Saved tower', latitude=17.1, longitude=54.2, area='Dhofar', voltage='132 kV')
        private = Tower(tower_id='Unrelated tower', latitude=20.0, longitude=55.0)
        db.add_all([shown, private]); db.flush()
        report = LineInspectionReport(team_id=team.id, report_number='SCOPE-1', start_date=dt.date(2026, 10, 1), end_date=dt.date(2026, 10, 14), scope_towers=[{'id': shown.id, 'name': 'Saved tower'}])
        db.add(report); db.commit()
        yield db, report, shown, private
    engine.dispose()


def customer(report):
    return User(username='customer', role='client', hashed_password='x', allowed_report_ids=[report.id])


def test_shared_report_only_returns_saved_scope_and_public_metadata(report_scope):
    db, report, shown, private = report_scope
    data = report_tower_locations(report.id, db, customer(report))['towers']
    assert [item['id'] for item in data] == [shown.id]
    assert private.id not in [item['id'] for item in data]
    assert data[0]['latitude'] == 17.1 and data[0]['longitude'] == 54.2
    assert set(data[0]) == {'id', 'latitude', 'longitude', 'area', 'line_sector', 'location_name', 'voltage', 'tower_type'}


def test_customer_cannot_read_unshared_report_locations(report_scope):
    db, report, _, _ = report_scope
    user = customer(report); user.allowed_report_ids = []
    with pytest.raises(HTTPException) as error:
        report_tower_locations(report.id, db, user)
    assert error.value.status_code == 403


def test_empty_saved_scope_does_not_expand_to_catalog(report_scope):
    db, report, _, _ = report_scope
    report.scope_towers = []; db.commit()
    assert report_tower_locations(report.id, db, customer(report)) == {'towers': []}


def test_missing_coordinates_remain_missing(report_scope):
    db, report, shown, _ = report_scope
    shown.latitude = None; shown.longitude = None; db.commit()
    data = report_tower_locations(report.id, db, customer(report))['towers'][0]
    assert data['latitude'] is None and data['longitude'] is None


def test_unknown_report_returns_not_found(report_scope):
    db, report, _, _ = report_scope
    with pytest.raises(HTTPException) as error:
        report_tower_locations(99999, db, customer(report))
    assert error.value.status_code == 404
