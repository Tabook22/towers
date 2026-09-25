import base64
import datetime as dt
import hashlib
import hmac
import json
import uuid

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.database import Base
from app.models import Team, User
from app.routers import live_help as live


@pytest.fixture
def setup():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team = Team(name='Field crew'); db.add(team); db.flush()
        a = User(username='admin', role='admin', hashed_password='test', is_super_admin=True)
        b = User(username='member', role='team_member', team_id=team.id, hashed_password='test', menu_permissions_csv='messages:full')
        c = User(username='other', role='team_leader', hashed_password='test', menu_permissions_csv='messages:full')
        db.add_all([a, b, c]); db.commit()
        yield db, a, b, c


def invite(setup):
    db, a, b, _ = setup
    return live.invite(live.Invite(device='caller-tab', user_id=b.id, subject='Please check this image'), db=db, user=a)


def accept(setup, room):
    db, _, b, _ = setup
    return live.action(room['id'], live.Action(device='guest-tab', action='accept'), db=db, user=b)


def post(db, user, room, kind='candidate', device='caller-tab', nonce=None):
    payload = {'candidate': 'candidate:example', 'sdpMid': '0'} if kind == 'candidate' else {'type': kind, 'sdp': 'v=0'}
    return live.signal(room['id'], live.Signal(device=device, nonce=nonce or uuid.uuid4(), kind=kind, payload=json.dumps(payload)), db=db, user=user)


def test_requires_individual_acceptance_before_signals_or_relay_credentials(setup):
    db, a, b, _ = setup
    room = invite(setup)
    for call in [lambda: post(db, a, room), lambda: live.connection(room['id'], Response(), device='caller-tab', db=db, user=a)]:
        with pytest.raises(HTTPException) as exc: call()
        assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        live.action(room['id'], live.Action(device='caller-tab', action='accept'), db=db, user=a)
    assert exc.value.status_code == 403
    accepted = accept(setup, room)
    assert accepted['owned'] and accepted['status'] == 'active'
    assert db.get(live.LiveRoom, room['id']).guest_device == 'guest-tab'


def test_nonparticipants_cannot_read_send_end_or_get_relay_credentials(setup):
    db, _, _, stranger = setup
    room = invite(setup); accept(setup, room)
    calls = [lambda: live.poll(room['id'], Response(), device='caller-tab', after=0, db=db, user=stranger),
             lambda: post(db, stranger, room),
             lambda: live.connection(room['id'], Response(), device='caller-tab', db=db, user=stranger),
             lambda: live.action(room['id'], live.Action(device='caller-tab', action='end'), db=db, user=stranger)]
    for call in calls:
        with pytest.raises(HTTPException) as exc: call()
        assert exc.value.status_code == 404


def test_busy_reservations_prevent_overlapping_invitations(setup):
    db, a, b, c = setup
    room = invite(setup)
    for caller, target in [(c, b), (a, c), (b, c)]:
        with pytest.raises(HTTPException) as exc:
            live.invite(live.Invite(device='another-tab', user_id=target.id), db=db, user=caller)
        assert exc.value.status_code == 409
    assert db.query(live.LiveRoom).count() == 1
    live.action(room['id'], live.Action(device='guest-tab', action='decline'), db=db, user=b)
    assert db.query(live.LiveSeat).count() == 0
    assert live.invite(live.Invite(device='another-tab', user_id=b.id), db=db, user=c)['status'] == 'ringing'


def test_only_one_tab_accepts_and_only_owner_tab_negotiates(setup):
    db, a, b, _ = setup
    room = invite(setup); accept(setup, room)
    with pytest.raises(HTTPException) as exc:
        live.action(room['id'], live.Action(device='other-tab', action='accept'), db=db, user=b)
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException): post(db, a, room, device='other-tab')
    with pytest.raises(HTTPException): live.poll(room['id'], Response(), device='other-tab', after=0, db=db, user=b)


def test_signals_direction_idempotency_and_cursor_isolation(setup):
    db, a, b, _ = setup
    room = invite(setup); accept(setup, room)
    nonce = uuid.uuid4()
    post(db, a, room, kind='offer', nonce=nonce); post(db, a, room, kind='offer', nonce=nonce)
    assert db.query(live.LiveSignal).count() == 1
    with pytest.raises(HTTPException): post(db, b, room, kind='offer', device='guest-tab')
    with pytest.raises(HTTPException): post(db, a, room, kind='answer')
    result = live.poll(room['id'], Response(), device='guest-tab', after=0, db=db, user=b)
    assert len(result['signals']) == 1
    cursor = result['signals'][0]['id']
    assert not live.poll(room['id'], Response(), device='guest-tab', after=cursor, db=db, user=b)['signals']
    assert not live.poll(room['id'], Response(), device='caller-tab', after=0, db=db, user=a)['signals']


def test_ending_erases_signalling_and_frees_both_people(setup):
    db, a, b, _ = setup
    room = invite(setup); accept(setup, room); post(db, a, room)
    live.action(room['id'], live.Action(device='guest-tab', action='end'), db=db, user=b)
    assert db.query(live.LiveSignal).count() == db.query(live.LiveSeat).count() == 0
    assert live.poll(room['id'], Response(), device='caller-tab', after=0, db=db, user=a)['room']['status'] == 'ended'
    with pytest.raises(HTTPException): post(db, a, room)


@pytest.mark.parametrize('active', [False, True])
def test_invitations_and_disconnected_sessions_expire(setup, monkeypatch, active):
    db, _, _, _ = setup
    room = invite(setup)
    if active: accept(setup, room)
    future = live.now() + dt.timedelta(seconds=95)
    monkeypatch.setattr(live, 'now', lambda: future)
    live.expire(db)
    assert db.get(live.LiveRoom, room['id']).status == 'expired'
    assert db.query(live.LiveSeat).count() == 0


def test_revoked_permission_ends_session(setup):
    db, _, b, _ = setup
    room = invite(setup); accept(setup, room)
    b.menu_permissions_csv = ''; db.commit(); live.expire(db)
    assert db.get(live.LiveRoom, room['id']).status == 'expired'


@pytest.mark.parametrize('role', ['client', 'unknown'])
def test_external_roles_excluded(setup, role):
    _, _, b, _ = setup
    b.role = role
    with pytest.raises(HTTPException): live.staff(b)


def test_relay_uses_expiring_credentials_and_is_not_cached(setup, monkeypatch):
    db, a, _, _ = setup
    room = invite(setup); accept(setup, room)
    monkeypatch.setattr(live.settings, 'live_turn_secret', 'test-secret')
    monkeypatch.setattr(live.settings, 'live_turn_urls', ['turn:relay.example:3478'])
    monkeypatch.setattr(live.time, 'time', lambda: 100000)
    response = Response()
    result = live.connection(room['id'], response, device='caller-tab', db=db, user=a)
    server = result['iceServers'][0]
    assert server['username'] == f'103600:{a.id}'
    assert server['credential'] == base64.b64encode(hmac.new(b'test-secret', server['username'].encode(), hashlib.sha1).digest()).decode()
    assert response.headers['Cache-Control'] == 'no-store'


def test_directory_only_exposes_staff_identity_and_availability(setup):
    db, a, b, _ = setup
    live.presence(live.Device(device='guest-tab'), Response(), db=db, user=b)
    db.add(User(username='customer', role='client', hashed_password='test', menu_permissions_csv='messages:full')); db.commit()
    items = live.contacts(Response(), db=db, user=a)
    target = next(i for i in items if i['id'] == b.id)
    assert target['team'] == 'Field crew' and target['online']
    assert all(i['name'] != 'customer' for i in items)
    assert set(target) == {'id', 'name', 'team', 'role', 'online', 'busy'}


@pytest.mark.parametrize('payload', ['not json', '[]', 'null', '{}', '{"candidate": 123}'])
def test_malformed_signals_are_refused_without_persistence(setup, payload):
    db, a, _, _ = setup
    room = invite(setup); accept(setup, room)
    with pytest.raises(HTTPException) as exc:
        live.signal(room['id'], live.Signal(device='caller-tab', nonce=uuid.uuid4(), kind='candidate', payload=payload), db=db, user=a)
    assert exc.value.status_code == 400
    assert db.query(live.LiveSignal).count() == 0


def test_invitations_are_rate_limited_even_after_cancellation(setup):
    db, a, _, _ = setup
    for _ in range(8):
        room = invite(setup)
        live.action(room['id'], live.Action(device='caller-tab', action='end'), db=db, user=a)
    with pytest.raises(HTTPException) as exc: invite(setup)
    assert exc.value.status_code == 429
