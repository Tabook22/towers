"""Private, consent-based WebRTC signalling. Media and chat never pass through this API.

Database-backed invitations work across uvicorn workers. Unique seats prevent simultaneous
calls; per-tab ownership prevents two browser tabs negotiating the same peer connection.
"""
import base64
import datetime as dt
import hashlib
import hmac
import json
import time
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.config import settings
from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Team, User

ROLES = ('admin', 'reviewer', 'team_leader', 'team_member', 'inspector')


class LivePresence(Base):
    __tablename__ = 'live_help_presence'
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), primary_key=True)
    seen: Mapped[dt.datetime] = mapped_column(DateTime)


class LiveRoom(Base):
    __tablename__ = 'live_help_rooms'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    caller: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    guest: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    caller_device: Mapped[str] = mapped_column(String(64))
    guest_device: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default='ringing', index=True)
    subject: Mapped[str] = mapped_column(String(160), default='')
    created: Mapped[dt.datetime] = mapped_column(DateTime)
    expires: Mapped[dt.datetime] = mapped_column(DateTime)
    caller_seen: Mapped[dt.datetime] = mapped_column(DateTime)
    guest_seen: Mapped[dt.datetime] = mapped_column(DateTime)


class LiveSeat(Base):
    __tablename__ = 'live_help_seats'
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey('live_help_rooms.id'), index=True)


class LiveSignal(Base):
    __tablename__ = 'live_help_signals'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey('live_help_rooms.id'), index=True)
    sender: Mapped[int] = mapped_column(ForeignKey('users.id'))
    nonce: Mapped[str] = mapped_column(String(36), unique=True)
    kind: Mapped[str] = mapped_column(String(12))
    payload: Mapped[str] = mapped_column(Text)


def now():
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def allowed(user):
    return user.is_active and user.is_approved and user.role in ROLES and (
        user.role == 'admin' and user.is_super_admin or 'messages' in user.menu_permissions)


def staff(user: User = Depends(get_current_user)):
    if not allowed(user):
        raise HTTPException(403, 'Live help is available to staff with Messages access')
    return user


router = APIRouter(prefix='/api/live-help', tags=['live-help'])


class Device(BaseModel):
    device: str = Field(min_length=8, max_length=64, pattern=r'^[a-zA-Z0-9-]+$')


class Invite(Device):
    user_id: int
    subject: str = Field(default='', max_length=160)


class Action(Device):
    action: Literal['accept', 'decline', 'end']


class Signal(Device):
    nonce: uuid.UUID
    kind: Literal['offer', 'answer', 'candidate']
    payload: str = Field(max_length=65000)


def finish(db, room, status='ended'):
    room.status = status
    db.query(LiveSeat).filter_by(room_id=room.id).delete()
    db.query(LiveSignal).filter_by(room_id=room.id).delete()


def expire(db):
    tick = now()
    for room in db.query(LiveRoom).filter(LiveRoom.status.in_(['ringing', 'active'])).all():
        stale = room.status == 'active' and min(room.caller_seen, room.guest_seen) < tick - dt.timedelta(seconds=75)
        participants = [db.get(User, room.caller), db.get(User, room.guest)]
        if room.expires < tick or stale or not all(u and allowed(u) for u in participants):
            finish(db, room, 'expired')
    # Retain only short-lived session metadata. No recordings or chat transcripts are stored.
    db.query(LiveRoom).filter(LiveRoom.created < tick - dt.timedelta(days=1), LiveRoom.status.notin_(['ringing', 'active'])).delete()
    db.commit()


def display(db, user_id):
    u = db.get(User, user_id)
    return u.full_name or u.username if u else 'Former member'


def room_out(db, room, user, device):
    owner = room.caller_device if room.caller == user.id else room.guest_device
    return dict(id=room.id, caller=room.caller, guest=room.guest, status=room.status,
                subject=room.subject, peer_name=display(db, room.guest if room.caller == user.id else room.caller),
                incoming=room.guest == user.id, owned=owner == device,
                expires=room.expires.isoformat() + 'Z')


def get_room(db, room_id, user, device=None):
    room = db.get(LiveRoom, room_id)
    if not room or user.id not in (room.caller, room.guest):
        raise HTTPException(404, 'Session not found')
    if device is not None:
        expected = room.caller_device if user.id == room.caller else room.guest_device
        if device != expected:
            raise HTTPException(409, 'This session belongs to another browser tab')
    return room


@router.post('/presence')
def presence(data: Device, response: Response, db: Session = Depends(get_db), user: User = Depends(staff)):
    response.headers['Cache-Control'] = 'no-store'
    expire(db)
    row = db.get(LivePresence, user.id)
    if row:
        row.seen = now()
    else:
        db.add(LivePresence(user_id=user.id, seen=now()))
    try:
        db.commit()
    except IntegrityError:  # Another tab signed in at the same instant.
        db.rollback()
    rooms = db.query(LiveRoom).filter(or_(LiveRoom.caller == user.id, LiveRoom.guest == user.id), LiveRoom.status.in_(['ringing', 'active'])).all()
    return {'rooms': [room_out(db, r, user, data.device) for r in rooms]}


@router.get('/contacts')
def contacts(response: Response, db: Session = Depends(get_db), user: User = Depends(staff)):
    response.headers['Cache-Control'] = 'no-store'
    expire(db)
    seen = {p.user_id: p.seen for p in db.query(LivePresence).all()}
    busy = {s.user_id for s in db.query(LiveSeat).all()}
    teams = {t.id: t.name for t in db.query(Team).all()}
    leaders = {t.leader_user_id: t.id for t in db.query(Team).all() if t.leader_user_id}
    return [dict(id=u.id, name=u.full_name or u.username, role=u.role,
                 team=teams.get(u.team_id or leaders.get(u.id), 'Administration' if u.role == 'admin' else 'Other staff'),
                 online=seen.get(u.id, dt.datetime.min) > now() - dt.timedelta(seconds=40), busy=u.id in busy)
            for u in db.query(User).filter(User.id != user.id, User.is_active.is_(True)).order_by(User.full_name, User.username).all() if allowed(u)]


@router.post('/rooms', status_code=201)
def invite(data: Invite, db: Session = Depends(get_db), user: User = Depends(staff)):
    expire(db)
    target = db.get(User, data.user_id)
    if not target or target.id == user.id or not allowed(target):
        raise HTTPException(400, 'Choose another available staff member')
    if db.query(LiveRoom).filter(LiveRoom.caller == user.id, LiveRoom.created > now() - dt.timedelta(minutes=5)).count() >= 8:
        raise HTTPException(429, 'Please wait before sending more invitations')
    room = LiveRoom(id=str(uuid.uuid4()), caller=user.id, guest=target.id, caller_device=data.device,
                    subject=data.subject.strip(), created=now(), expires=now() + dt.timedelta(seconds=90),
                    caller_seen=now(), guest_seen=now(), status='ringing')
    db.add(room)
    try:
        db.flush()
        db.add_all([LiveSeat(user_id=user.id, room_id=room.id), LiveSeat(user_id=target.id, room_id=room.id)])
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'You or this person already have a live-help invitation or session')
    return room_out(db, room, user, data.device)


@router.post('/rooms/{room_id}/action')
def action(room_id: str, data: Action, db: Session = Depends(get_db), user: User = Depends(staff)):
    expire(db)
    room = get_room(db, room_id, user)
    if data.action == 'accept':
        if user.id != room.guest:
            raise HTTPException(403, 'Only the invited person can accept')
        updated = db.query(LiveRoom).filter_by(id=room_id, status='ringing').update(dict(status='active', guest_device=data.device,
            caller_seen=now(), guest_seen=now(), expires=now() + dt.timedelta(minutes=45)), synchronize_session=False)
        if not updated:
            db.rollback()
            raise HTTPException(409, 'This invitation has already been answered or expired')
    else:
        if data.action == 'decline' and (user.id != room.guest or room.status != 'ringing'):
            raise HTTPException(409, 'This invitation cannot be declined')
        if room.status in ('ringing', 'active'):
            finish(db, room, 'declined' if data.action == 'decline' else 'ended')
    db.commit()
    db.refresh(room)
    return room_out(db, room, user, data.device)


@router.get('/rooms/{room_id}')
def poll(room_id: str, response: Response, device: str = Query(min_length=8, max_length=64), after: int = Query(default=0, ge=0), db: Session = Depends(get_db), user: User = Depends(staff)):
    response.headers['Cache-Control'] = 'no-store'
    expire(db)
    room = get_room(db, room_id, user, device)
    if room.status in ('ringing', 'active'):
        if user.id == room.caller:
            room.caller_seen = now()
        else:
            room.guest_seen = now()
        db.commit()
    signals = db.query(LiveSignal).filter(LiveSignal.room_id == room.id, LiveSignal.sender != user.id, LiveSignal.id > after).order_by(LiveSignal.id).limit(256).all() if room.status == 'active' else []
    return dict(room=room_out(db, room, user, device), signals=[dict(id=s.id, kind=s.kind, payload=s.payload) for s in signals])


@router.post('/rooms/{room_id}/signals', status_code=201)
def signal(room_id: str, data: Signal, db: Session = Depends(get_db), user: User = Depends(staff)):
    expire(db)
    room = get_room(db, room_id, user, data.device)
    if room.status != 'active':
        raise HTTPException(409, 'Both people must join before connecting')
    if (data.kind == 'offer' and user.id != room.caller) or (data.kind == 'answer' and user.id != room.guest):
        raise HTTPException(403, 'Invalid signalling direction')
    if data.kind == 'candidate' and len(data.payload) > 4096:
        raise HTTPException(400, 'Candidate too large')
    try:
        payload = json.loads(data.payload)
        valid = isinstance(payload, dict) and (
            isinstance(payload.get('candidate'), str) and isinstance(payload.get('sdpMid'), (str, type(None)))
            if data.kind == 'candidate' else payload.get('type') == data.kind and isinstance(payload.get('sdp'), str))
        if not valid:
            raise ValueError()
    except (ValueError, AttributeError):
        raise HTTPException(400, 'Invalid connection message')
    # Serialize writes with ending/expiry and other signal requests, also across workers.
    if not db.query(LiveRoom).filter_by(id=room_id, status='active').update(
            {LiveRoom.caller_seen if user.id == room.caller else LiveRoom.guest_seen: now()}, synchronize_session=False):
        db.rollback()
        raise HTTPException(409, 'Session has ended')
    if db.query(LiveSignal).filter_by(room_id=room_id, sender=user.id, nonce=str(data.nonce)).first():
        db.commit()
        return {'ok': True}
    if data.kind != 'candidate' and db.query(LiveSignal).filter_by(room_id=room_id, kind=data.kind).first():
        db.rollback()
        raise HTTPException(409, 'Connection already negotiated; start a new session')
    if db.query(LiveSignal).filter_by(room_id=room_id).count() >= 256:
        db.rollback()
        raise HTTPException(429, 'Connection negotiation limit reached; start a new session')
    db.add(LiveSignal(room_id=room_id, sender=user.id, nonce=str(data.nonce), kind=data.kind, payload=data.payload))
    db.commit()
    return {'ok': True}


@router.get('/rooms/{room_id}/connection')
def connection(room_id: str, response: Response, device: str = Query(min_length=8, max_length=64), db: Session = Depends(get_db), user: User = Depends(staff)):
    response.headers['Cache-Control'] = 'no-store'
    expire(db)
    room = get_room(db, room_id, user, device)
    if room.status != 'active':
        raise HTTPException(409, 'Accept the invitation first')
    servers = []
    if settings.live_turn_secret and settings.live_turn_urls:
        username = f'{int(time.time()) + 3600}:{user.id}'
        credential = base64.b64encode(hmac.new(settings.live_turn_secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
        servers.append(dict(urls=settings.live_turn_urls, username=username, credential=credential))
    return {'iceServers': servers, 'relay_configured': bool(servers)}
