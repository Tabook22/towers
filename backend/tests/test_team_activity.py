import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.deps import require_menu_item
from app.models import (Team, Tower, User, Visit, Position, TeamOutingPlan,
                        TeamOutingTower, NightTowerClaim, LineInspectionReport)
from app.routers.team_activity import activity
from app.routers.reports import _report_tower_scope

DAY = dt.date(2026, 9, 10)
NEXT = DAY + dt.timedelta(days=1)


@pytest.fixture
def data():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        teams = [Team(name='Alpha'), Team(name='Bravo', is_active=False)]
        towers = [Tower(tower_id=f'T-{i}', voltage='132') for i in range(1, 5)]
        admin = User(username='admin', hashed_password='x', role='admin', is_super_admin=True)
        db.add_all([*teams, *towers, admin]); db.flush()
        plan = TeamOutingPlan(team_id=teams[0].id, field_date=DAY, name='North line')
        db.add(plan); db.flush()
        db.add_all([TeamOutingTower(plan_id=plan.id, tower_pk=t.id, sort_order=i) for i, t in enumerate(towers[:3])])
        visits = [Visit(team_id=teams[0].id, tower_id=towers[i].id, inspection_date=DAY,
                        mission_status=status) for i, status in [(0, 'completed'), (0, 'in_progress'), (1, 'planned'), (3, 'in_progress')]]
        db.add_all(visits); db.commit()
        yield db, teams, towers, admin, visits


def summary(data, **kwargs):
    db, _, _, admin, _ = data
    return activity(start_date=DAY, end_date=NEXT, db=db, user=admin, **kwargs)['teams']


def save_report(data, scope, start=DAY, end=DAY):
    db, teams, _, _, _ = data
    r = LineInspectionReport(team_id=teams[0].id, start_date=start, end_date=end,
                             report_number='R-1', scope_towers=scope)
    db.add(r); db.commit()
    return r


def test_mission_recorded_visited_finished_and_report_counts_are_distinct(data):
    db, _, _, _, visits = data
    save_report(data, _report_tower_scope([visits[0]]))
    save_report(data, _report_tower_scope([visits[0]]))
    team = summary(data)[0]
    assert team['counts'] == dict(planned=3, visited=2, recorded=3, finished=1, reported=1)
    assert team['mission_count'] == 1
    assert len(team['reports']) == 2
    assert len(team['days'][0]['towers']) == 4
    assert len(team['days'][0]['towers'][0]['visit_ids']) == 2
    assert not team['days'][0]['towers'][3]['planned']


def test_repeated_days_deduplicate_period_totals_and_show_missing_plan(data):
    db, teams, towers, _, _ = data
    db.add(Visit(team_id=teams[0].id, tower_id=towers[0].id, inspection_date=NEXT, mission_status='completed'))
    db.commit()
    team = summary(data)[0]
    assert team['counts']['visited'] == 2
    assert sum(day['counts']['visited'] for day in team['days']) == 3
    assert team['days'][0]['date'] == NEXT.isoformat()
    assert team['days'][0]['has_mission'] is False


def test_empty_position_is_not_a_visit_but_screening_is(data):
    db, _, _, _, visits = data
    p = Position(visit_id=visits[2].id, ohl='OHL1', phase='R', string='S1')
    db.add(p); db.commit()
    assert summary(data)[0]['counts']['visited'] == 2
    p.screening_result = 'Normal'; db.commit()
    assert summary(data)[0]['counts']['visited'] == 3


def test_checkin_without_inspection_record_counts_visit_not_record(data):
    db, teams, towers, admin, _ = data
    db.add(NightTowerClaim(team_id=teams[0].id, tower_pk=towers[2].id, field_date=DAY,
                           assigned_user_id=admin.id, status='done'))
    db.commit()
    counts = summary(data)[0]['counts']
    assert counts['visited'] == 3 and counts['finished'] == 2 and counts['recorded'] == 3


def test_report_dates_and_membership_survive_inspection_edits(data):
    db, teams, towers, _, visits = data
    save_report(data, _report_tower_scope([visits[0]]), DAY, NEXT)
    visits[0].inspection_date = NEXT
    visits[0].team_id = teams[1].id
    towers[0].assigned_team_id = teams[1].id
    db.commit()
    team = summary(data)[0]
    assert next(d for d in team['days'] if d['date'] == DAY.isoformat())['counts']['reported'] == 1
    assert team['undated_report_towers'] == 0


def test_old_multiday_report_does_not_guess_daily_coverage(data):
    _, _, towers, _, _ = data
    save_report(data, [{'id': towers[0].id, 'name': towers[0].tower_id}], DAY, NEXT)
    save_report(data, None, DAY, NEXT)
    team = summary(data)[0]
    assert team['counts']['reported'] == 1
    assert team['days'][0]['counts']['reported'] == 0
    assert team['undated_report_towers'] == 1
    assert team['unknown_scope_reports'] == 1


def test_old_single_day_report_has_unambiguous_day(data):
    _, _, towers, _, _ = data
    save_report(data, [{'id': towers[0].id, 'name': towers[0].tower_id}])
    assert summary(data)[0]['days'][0]['counts']['reported'] == 1


def test_report_with_snapshot_dates_outside_filter_does_not_inflate_count(data):
    _, _, _, _, visits = data
    save_report(data, _report_tower_scope([visits[0]]), DAY, NEXT)
    db, teams, _, admin, _ = data
    rows = activity(start_date=NEXT, end_date=NEXT, db=db, user=admin)['teams']
    assert rows[0]['counts']['reported'] == 0


@pytest.mark.parametrize('role', ['team_leader', 'team_member'])
def test_crew_cannot_read_other_team(data, role):
    db, teams, _, _, _ = data
    crew = User(username='crew', hashed_password='x', role=role, team_id=teams[0].id)
    db.add(crew); db.commit()
    assert len(activity(start_date=DAY, end_date=NEXT, db=db, user=crew)['teams']) == 1
    with pytest.raises(HTTPException) as exc:
        activity(team_id=teams[1].id, db=db, user=crew)
    assert exc.value.status_code == 403
    crew.team_id = None; db.commit()
    assert activity(db=db, user=crew)['teams'] == []


def test_client_and_restricted_admin_cannot_read_summary(data):
    db, _, _, admin, _ = data
    client = User(username='client', role='client', hashed_password='x')
    with pytest.raises(HTTPException):
        activity(db=db, user=client)
    admin.is_super_admin = False
    admin.menu_permissions_csv = ''
    with pytest.raises(HTTPException):
        require_menu_item('teams')(admin)


@pytest.mark.parametrize('start,end', [(NEXT, DAY), (DAY, DAY + dt.timedelta(days=367))])
def test_invalid_ranges_rejected(data, start, end):
    db, _, _, admin, _ = data
    with pytest.raises(HTTPException) as exc:
        activity(start_date=start, end_date=end, db=db, user=admin)
    assert exc.value.status_code == 422


def test_archived_teams_remain_in_history_and_team_filter_works(data):
    _, teams, _, _, _ = data
    assert len(summary(data)) == 2
    assert summary(data, team_id=teams[1].id)[0]['is_active'] is False
