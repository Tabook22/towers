import datetime as dt

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Team, Tower, User, FieldNotice, NoticeAcknowledgement, Visit
from app.routers import notices as n


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(n, 'today', lambda: dt.date(2026, 9, 25))
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        a, b = Team(name='Alpha'), Team(name='Bravo')
        db.add_all([a, b]); db.flush()
        admin = User(username='admin', role='admin', is_super_admin=True, hashed_password='test')
        leader = User(username='leader', role='team_leader', team_id=a.id, hashed_password='test')
        crew = User(username='crew', role='team_member', team_id=a.id, hashed_password='test')
        other = User(username='other', role='team_member', team_id=b.id, hashed_password='test')
        tower = Tower(tower_id='T-1', voltage='132', assigned_team_id=a.id)
        db.add_all([admin, leader, crew, other, tower]); db.commit()
        yield db, admin, leader, crew, other, tower


def publish(setup, **values):
    db, admin, *_ = setup
    return n.create(n.NoticeInput(title='Check the images', body='Upload the missing RGB close-up.', **values), db=db, user=admin)


def listing(db, user, **kwargs):
    return n.history(db=db, user=user, offset=0, limit=20, **kwargs)


def ack(db, user, item):
    return n.acknowledge(item['id'], n.AcknowledgeInput(revision=item['revision']), db=db, user=user)


def state(db, user, item, action):
    return n.set_state(item['id'], n.NoticeState(action=action, expected_version=item['version']), db=db, user=user)


def edit(db, user, item, **values):
    data = {key: item[key] for key in n.NoticeInput.model_fields}
    data.update(values)
    return n.edit(item['id'], n.NoticeEdit(**data, expected_version=item['version']), db=db, user=user)


def test_everyone_and_team_notices_have_server_side_visibility(setup):
    db, admin, leader, crew, other, _ = setup
    broadcast = publish(setup)
    scoped = publish(setup, team_id=crew.team_id)
    assert {r['id'] for r in listing(db, crew)['items']} == {broadcast['id'], scoped['id']}
    assert {r['id'] for r in listing(db, other)['items']} == {broadcast['id']}
    with pytest.raises(HTTPException) as error:
        n.get_notice(db, other, scoped['id'])
    assert error.value.status_code == 404
    assert len(listing(db, admin)['items']) == 2


@pytest.mark.parametrize('role', ['team_member', 'inspector', 'client'])
def test_non_managers_cannot_publish(setup, role):
    db, _, _, crew, _, _ = setup
    crew.role = role
    with pytest.raises(HTTPException):
        n.create(n.NoticeInput(title='No', body='No'), db=db, user=crew)


def test_client_cannot_read_or_acknowledge(setup):
    db, _, _, crew, _, _ = setup
    notice = publish(setup)
    crew.role = 'client'
    with pytest.raises(HTTPException): listing(db, crew)
    with pytest.raises(HTTPException): ack(db, crew, notice)


def test_team_leader_can_publish_only_own_team_and_manage_only_own_notes(setup):
    db, admin, leader, crew, other, _ = setup
    for team_id in [None, other.team_id]:
        with pytest.raises(HTTPException):
            n.create(n.NoticeInput(title='No', body='No', team_id=team_id), db=db, user=leader)
    own = n.create(n.NoticeInput(title='Own', body='Own instructions', team_id=leader.team_id), db=db, user=leader)
    assert own['can_manage']
    assert state(db, leader, own, 'archive')['status'] == 'archived'
    admin_note = publish(setup, team_id=leader.team_id)
    with pytest.raises(HTTPException): state(db, leader, admin_note, 'archive')


def test_restricted_admin_needs_full_team_management_and_menu_access(setup):
    db, admin, *_ = setup
    admin.is_super_admin = False
    admin.permissions_csv = 'manage_teams:add'
    admin.menu_permissions_csv = 'teams:full'
    with pytest.raises(HTTPException): publish(setup)
    admin.permissions_csv = 'manage_teams:full'
    admin.menu_permissions_csv = ''
    with pytest.raises(HTTPException): publish(setup)
    admin.menu_permissions_csv = 'teams:full'
    assert publish(setup)['id']


def test_owner_and_tower_must_belong_to_target_team(setup):
    db, _, _, crew, other, tower = setup
    with pytest.raises(HTTPException): publish(setup, category='action', team_id=crew.team_id, owner_id=other.id)
    with pytest.raises(HTTPException): publish(setup, team_id=other.team_id, tower_id=tower.id)
    db.add(Visit(team_id=other.team_id, tower_id=tower.id)); db.commit()
    assert publish(setup, team_id=other.team_id, tower_id=tower.id)['tower_name'] == 'T-1'


def test_acknowledgement_is_idempotent_and_never_completes_an_action(setup):
    db, _, _, crew, _, _ = setup
    notice = publish(setup, category='action', owner_id=crew.id)
    ack(db, crew, notice); result = ack(db, crew, notice)
    assert result['acknowledged'] and result['status'] == 'active'
    assert result['completed_at'] is None
    assert db.query(NoticeAcknowledgement).count() == 1
    done = state(db, crew, result, 'complete')
    assert done['status'] == 'completed' and done['acknowledged']
    assert done['completed_by_name'] == crew.username


def test_only_assignee_or_manager_can_complete_assigned_action(setup):
    db, admin, leader, crew, other, _ = setup
    notice = publish(setup, category='action', team_id=crew.team_id, owner_id=crew.id)
    with pytest.raises(HTTPException): state(db, leader, notice, 'complete')
    assert state(db, admin, notice, 'complete')['status'] == 'completed'


def test_update_and_urgent_are_not_action_tasks(setup):
    db, admin, _, crew, _, _ = setup
    for category in ('update', 'urgent'):
        notice = publish(setup, category=category)
        with pytest.raises(HTTPException): state(db, admin, notice, 'complete')


def test_content_edit_resets_acknowledgements_and_rejects_old_version(setup):
    db, admin, _, crew, _, _ = setup
    note = publish(setup, category='urgent')
    ack(db, crew, note)
    assert listing(db, crew)['urgent'] is None
    updated = edit(db, admin, note, body='Updated instruction')
    assert updated['revision'] == 2
    assert listing(db, crew)['urgent']['id'] == note['id']
    with pytest.raises(HTTPException) as error: ack(db, crew, note)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error: edit(db, admin, note, title='Stale overwrite')
    assert error.value.status_code == 409
    assert db.get(FieldNotice, note['id']).body == 'Updated instruction'


def test_archive_and_restore_preserve_receipts_and_stale_state_fails(setup):
    db, admin, _, crew, _, _ = setup
    notice = publish(setup)
    ack(db, crew, notice)
    archived = state(db, admin, notice, 'archive')
    assert listing(db, crew)['items'] == []
    assert listing(db, crew, state='history')['items'][0]['id'] == notice['id']
    with pytest.raises(HTTPException) as error: state(db, admin, notice, 'restore')
    assert error.value.status_code == 409
    restored = state(db, admin, archived, 'restore')
    assert restored['status'] == 'active'
    assert listing(db, crew)['items'][0]['acknowledged']


def test_expiry_uses_inclusive_oman_date_and_moves_to_history(setup, monkeypatch):
    db, admin, _, crew, _, _ = setup
    notice = publish(setup, category='urgent', expires_on=dt.date(2026, 9, 25))
    assert listing(db, crew)['urgent']
    monkeypatch.setattr(n, 'today', lambda: dt.date(2026, 9, 26))
    assert listing(db, crew)['urgent'] is None
    assert listing(db, crew, state='history')['items'][0]['status'] == 'expired'
    with pytest.raises(HTTPException): ack(db, crew, notice)


def test_reopen_action_preserves_read_acknowledgement(setup):
    db, admin, _, crew, _, _ = setup
    notice = publish(setup, category='action')
    ack(db, crew, notice)
    done = state(db, crew, notice, 'complete')
    assert listing(db, crew)['items'] == []
    assert state(db, admin, done, 'reopen')['completed_at'] is None
    assert listing(db, crew)['items'][0]['acknowledged']


def test_receipts_are_manager_only_and_show_unacknowledged_recipients(setup):
    db, admin, leader, crew, other, _ = setup
    notice = publish(setup, team_id=crew.team_id)
    ack(db, crew, notice)
    people = n.receipts(notice['id'], db=db, user=admin)['people']
    assert {p['id'] for p in people} == {admin.id, leader.id, crew.id}
    assert next(p for p in people if p['id'] == crew.id)['acknowledged_at']
    with pytest.raises(HTTPException): n.receipts(notice['id'], db=db, user=crew)


def test_pagination_and_urgent_banner_are_independent(setup):
    db, admin, _, crew, _, _ = setup
    first = publish(setup, category='urgent')
    second = publish(setup, category='urgent')
    ack(db, crew, second)
    page = n.history(db=db, user=crew, offset=0, limit=1)
    assert page['total'] == 2 and len(page['items']) == 1
    assert page['urgent']['id'] == first['id']
    assert page['urgent_unacknowledged'] == 1
    assert listing(db, crew, search='missing RGB')['total'] == 2
    assert listing(db, crew, category='action')['total'] == 0


def test_options_do_not_expose_other_teams_to_leaders(setup):
    db, _, leader, crew, other, tower = setup
    opts = n.options(db=db, user=leader)
    assert [t['id'] for t in opts['teams']] == [leader.team_id]
    assert other.id not in {p['id'] for p in opts['people']}
    assert not opts['can_broadcast']
    assert n.options(db=db, user=crew)['people'] == []


@pytest.mark.parametrize('values', [dict(title='  '), dict(body='  '), dict(category='invalid'),
    dict(expires_on='2026-09-24'), dict(category='action', due_on='2026-10-01', expires_on='2026-09-30'),
    dict(category='update', owner_id=1)])
def test_notice_input_validation(setup, values):
    fields = dict(title='Title', body='Body'); fields.update(values)
    with pytest.raises(ValidationError): n.NoticeInput(**fields)


def test_http_routes_validate_and_serialize_the_complete_workflow(setup):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.database import get_db
    from app.deps import get_current_user
    db, admin, _, crew, other, _ = setup
    app = FastAPI()
    app.include_router(n.router)
    app.dependency_overrides[get_db] = lambda: db
    actor = [admin]
    client = TestClient(app)
    assert client.get('/api/notices').status_code == 401
    app.dependency_overrides[get_current_user] = lambda: actor[0]
    assert client.post('/api/notices', json={'title': ' ', 'body': 'No'}).status_code == 422
    response = client.post('/api/notices', json={'title': 'Check', 'body': 'Do the check', 'category': 'action', 'team_id': crew.team_id, 'owner_id': crew.id})
    assert response.status_code == 201
    item = response.json()
    actor[0] = other
    assert client.get('/api/notices').json()['items'] == []
    assert client.post(f"/api/notices/{item['id']}/acknowledge", json={'revision': 1}).status_code == 404
    actor[0] = crew
    result = client.post(f"/api/notices/{item['id']}/acknowledge", json={'revision': 1})
    assert result.json()['acknowledged']
    done = client.post(f"/api/notices/{item['id']}/state", json={'action': 'complete', 'expected_version': 1})
    assert done.status_code == 200 and done.json()['status'] == 'completed'
    assert client.get('/api/notices?state=history').json()['total'] == 1
