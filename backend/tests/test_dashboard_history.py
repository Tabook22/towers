import datetime as dt

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Image, Position, Team, Tower, User, Visit
from app.routers.dashboard import dashboard_summary, dashboard_tower_history


@pytest.fixture()
def db():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def setup_history(db):
    a, b = Team(name='First crew'), Team(name='Second crew')
    db.add_all([a, b]); db.flush()
    towers = [Tower(tower_id='T10', area='North', assigned_team_id=a.id),
              Tower(tower_id='T2', area='North', assigned_team_id=a.id),
              Tower(tower_id='T3', area='South', assigned_team_id=b.id),
              Tower(tower_id='T4', area='North', is_active=False)]
    db.add_all(towers); db.flush()
    visits = [Visit(tower_id=towers[0].id, team_id=a.id, inspection_date=dt.date(2026, 9, 20), mission_status='completed'),
              Visit(tower_id=towers[0].id, team_id=b.id, inspection_date=dt.date(2026, 9, 21), mission_status='in_progress'),
              Visit(tower_id=towers[1].id, team_id=a.id, inspection_date=dt.date(2026, 10, 1))]
    db.add_all(visits); db.commit()
    return a, b, towers, visits


def test_history_preserves_visit_teams_dates_and_all_visits(db):
    a, b, towers, visits = setup_history(db)
    rows = dashboard_tower_history(db, User(role='admin'), 'North')
    assert [r.tower.tower_id for r in rows] == ['T2', 'T10']
    assert [v.team_name for v in rows[1].visits] == ['Second crew', 'First crew']
    assert [v.team_id for v in rows[1].visits] == [b.id, a.id]
    assert [v.inspection_date for v in rows[1].visits] == [dt.date(2026, 9, 21), dt.date(2026, 9, 20)]
    assert all(v.has_field_activity for v in rows[1].visits)
    assert not rows[0].visits[0].has_field_activity  # a scheduled date alone is not a visit
    assert len(dashboard_tower_history(db, User(role='admin'), None)) == 3
    summary = dashboard_summary(db, User(role='admin'), 'North')
    assert summary.tower_count == len(rows)
    assert summary.visit_count == sum(len(row.visits) for row in rows)
    assert summary.rows[1].latest_visit.id == visits[1].id
    assert summary.rows[1].latest_visit.team_name == 'Second crew'


@pytest.mark.parametrize('role', ['team_leader', 'team_member'])
def test_crew_history_matches_dashboard_scope_and_hides_other_crews(db, role):
    a, b, towers, visits = setup_history(db)
    rows = dashboard_tower_history(db, User(role=role, team_id=a.id), None)
    assert {r.tower.id for r in rows} == {towers[0].id, towers[1].id}
    assert {v.team_name for r in rows for v in r.visits} == {'First crew'}
    summary = dashboard_summary(db, User(role=role, team_id=a.id), None)
    assert {r.latest_visit.team_name for r in summary.rows} == {'First crew'}
    assert dashboard_tower_history(db, User(role=role, team_id=a.id), 'South') == []
    assert dashboard_tower_history(db, User(id=999, role=role), None) == []


@pytest.mark.parametrize('kind', ['screening', 'direction', 'image'])
def test_legacy_field_activity_counts_without_mission_status_or_date(db, kind):
    tower = Tower(tower_id='Legacy')
    db.add(tower); db.flush()
    visit = Visit(tower_id=tower.id)
    db.add(visit); db.flush()
    pos = Position(visit_id=visit.id, ohl='OHL1', phase='R', string='S1')
    db.add(pos); db.commit()
    assert not dashboard_tower_history(db, User(role='admin'), None)[0].visits[0].has_field_activity
    if kind == 'screening':
        pos.screening_result = 'Hotspot detected'
        pos.hotspot = 'Yes'
    elif kind == 'direction':
        pos.direction = 'Ashoor'
    else:
        db.add(Image(position_id=pos.id, image_type='TH Full', file_path='evidence.jpg'))
    db.commit(); db.expire_all()
    result = dashboard_tower_history(db, User(role='admin'), None)[0].visits[0]
    assert result.has_field_activity
    assert result.team_name is None and result.inspection_date is None
    if kind == 'screening':
        assert result.rollup.hotspots == 1 and result.rollup.screened == 1


def test_history_uses_batched_queries(db):
    setup_history(db)
    statements = []
    def record(*args):
        statements.append(args[2])
    event.listen(db.bind, 'before_cursor_execute', record)
    try:
        dashboard_tower_history(db, User(role='admin'), None)
    finally:
        event.remove(db.bind, 'before_cursor_execute', record)
    assert len(statements) <= 5
