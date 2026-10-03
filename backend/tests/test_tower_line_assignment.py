import datetime as dt

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Team, Tower, User, Visit
from app.routers.towers import assign_tower_line, router
from app.schemas import TowerBulkLineRequest


@pytest.fixture
def db():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def payload(rows, line='Saada-Shahaon'):
    return TowerBulkLineRequest(towers=[{'tower_id': tower.id, 'expected_line_sector': expected} for tower, expected in rows], line_sector=line)


def test_assignment_preserves_every_non_line_value_and_inspection_row(db):
    team = Team(name='Original team')
    user = User(username='inspector', full_name='Inspector', hashed_password='unused', role='team_leader')
    db.add_all([team, user]); db.flush()
    tower = Tower(tower_id='Saada-Shahaon-12', assigned_team_id=team.id, notes='Original notes', latitude=17.2, longitude=54.1)
    other = Tower(tower_id='Other-1', line_sector='Ashoor-Saada')
    db.add_all([tower, other]); db.flush()
    visit = Visit(tower_id=tower.id, inspector_name=user.full_name, team_id=team.id, inspection_date=dt.date(2026, 10, 4))
    db.add(visit); db.commit()
    # Entire tables, including stored report/image/position records, remain untouched.
    before = {table.name: list(db.execute(select(table)).tuples()) for table in Base.metadata.sorted_tables if table.name != 'towers'}
    columns = [column for column in Tower.__table__.columns if column.name not in ('line_sector', 'updated_at')]
    tower_values = list(db.execute(select(*columns)).tuples())
    result = assign_tower_line(payload([(tower, None)]), db, User(role='admin'))
    assert result[0].line_sector == 'Saada-Shahaon'
    assert list(db.execute(select(*columns)).tuples()) == tower_values
    assert {table.name: list(db.execute(select(table)).tuples()) for table in Base.metadata.sorted_tables if table.name != 'towers'} == before
    assert other.line_sector == 'Ashoor-Saada'


@pytest.mark.parametrize('inactive', [False, True])
def test_stale_or_inactive_selection_rolls_back_every_tower(db, inactive):
    first = Tower(tower_id='First')
    stale = Tower(tower_id='Second', line_sector='Ittin-Thumrait', is_active=not inactive)
    db.add_all([first, stale]); db.commit()
    with pytest.raises(HTTPException) as error:
        assign_tower_line(payload([(first, None), (stale, 'Ittin-Thumrait' if inactive else None)]), db, User(role='admin'))
    assert error.value.status_code == 409
    db.refresh(first); db.refresh(stale)
    assert first.line_sector is None and stale.line_sector == 'Ittin-Thumrait'


def test_missing_tower_does_not_update_the_remaining_selection(db):
    tower = Tower(tower_id='Keep'); db.add(tower); db.commit()
    request = TowerBulkLineRequest(towers=[{'tower_id': tower.id, 'expected_line_sector': None}, {'tower_id': 999, 'expected_line_sector': None}], line_sector='Ashoor-Saada')
    with pytest.raises(HTTPException) as error:
        assign_tower_line(request, db, User(role='admin'))
    assert error.value.status_code == 404 and tower.line_sector is None


@pytest.mark.parametrize('changes', [
    {'line_sector': 'Typo line'}, {'line_sector': ''}, {'towers': []},
    {'towers': [{'tower_id': 1, 'expected_line_sector': None}, {'tower_id': 1, 'expected_line_sector': None}]},
    {'towers': [{'tower_id': 1}]},
])
def test_only_confirmed_lines_and_unique_explicit_original_values_are_accepted(changes):
    values = {'line_sector': 'Ashoor-Saada', 'towers': [{'tower_id': 1, 'expected_line_sector': None}]}
    with pytest.raises(ValidationError): TowerBulkLineRequest(**(values | changes))


@pytest.mark.parametrize('role,permission,status', [('admin', 'manage_towers:view', 403), ('admin', 'manage_towers:add', 403), ('team_leader', None, 403), ('client', None, 403), ('admin', 'manage_towers:full', 200), ('reviewer', None, 200)])
def test_http_route_requires_full_catalog_permission(db, role, permission, status):
    tower = Tower(tower_id='T1'); db.add(tower); db.commit()
    app = FastAPI(); app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username='operator', role=role, permissions_csv=permission, is_super_admin=False)
    with TestClient(app) as client:
        response = client.post('/api/towers/bulk-line', json={'line_sector': 'Ashoor-Saada', 'towers': [{'tower_id': tower.id, 'expected_line_sector': None}]})
    assert response.status_code == status
    db.refresh(tower)
    assert tower.line_sector == ('Ashoor-Saada' if status == 200 else None)
