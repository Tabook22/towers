import asyncio
import datetime as dt
import io
import pytest
from fastapi import BackgroundTasks, HTTPException, UploadFile
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateTable
from starlette.datastructures import Headers
from app.database import Base
from app.models import Team, TeamChannelMessage, User
from app.routers import community, channel
from app.migrations import allow_unassigned_channel_authors

@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(channel.settings, 'channel_dir', tmp_path)
    engine=create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session

def send(db,user,**kwargs):
    options=dict(body='Hello everyone 👋',attachment_type=None,file=None,duration_seconds=None,latitude=None,longitude=None)
    options.update(kwargs)
    return asyncio.run(community.post(BackgroundTasks(), db=db, user=community.internal_user(user), **options))

@pytest.mark.parametrize('role', ['admin','reviewer','team_member','team_leader'])
def test_all_internal_roles_can_speak_without_team_assignment(db,role):
    user=User(username=role,role=role,hashed_password='test')
    db.add(user); db.commit()
    result=send(db,user)
    assert result.team_id is None and result.created_by == user.id
    assert result.body == 'Hello everyone 👋'
    assert community.history(db=db,user=user)['messages'][0].id == result.id

def test_members_keep_their_identity_and_no_implicit_location(db,monkeypatch):
    team=Team(name='Alpha'); db.add(team); db.flush()
    user=User(username='crew',role='team_member',team_id=team.id,hashed_password='test'); db.add(user); db.commit()
    monkeypatch.setattr(channel,'_fallback_gps',lambda *args: pytest.fail('Location should only be explicitly shared'))
    result=send(db,user)
    assert result.team_id == team.id and result.team_name == 'Alpha'
    assert result.latitude is None and result.tower_id is None

def test_clients_are_excluded(db):
    with pytest.raises(HTTPException) as exc: send(db,User(role='client'))
    assert exc.value.status_code == 403

def test_history_paginates_across_days_and_filters_ops_and_search(db):
    user=User(username='admin',role='admin',hashed_password='test'); db.add(user); db.flush()
    for i in range(125):
        db.add(TeamChannelMessage(team_id=None,field_date=dt.date(2026,8,1),created_by=user.id,body=f'Chat {i}',kind='note'))
    db.add(TeamChannelMessage(field_date=dt.date(2026,9,1),body='Assignment',kind='assign'))
    db.commit()
    page=community.history(db=db,user=user)
    ids=[m.id for m in page['messages']]
    while page['has_more']:
        page=community.history(before_id=page['before_id'],db=db,user=user)
        ids += [m.id for m in page['messages']]
    assert len(ids)==len(set(ids))==125
    assert community.history(search='Chat 124',db=db,user=user)['messages'][0].body=='Chat 124'
    assert community.history(include_ops=True,db=db,user=user)['messages'][-1].kind=='assign'
    assert not community.history(search='%',db=db,user=user)['messages']

@pytest.mark.parametrize('kind,mime,name,attribute,route', [('photo','image/png','photo.png','has_photo','photo'),('video','video/mp4','clip.mp4','has_video','video'),('voice','audio/webm','voice.webm','has_audio','audio'),('file','application/pdf','permit.pdf','has_file','file')])
def test_shared_attachments_work_for_unassigned_admin(db,kind,mime,name,attribute,route):
    user=User(username='admin',role='admin',hashed_password='test'); db.add(user); db.commit()
    f=UploadFile(filename=name,file=io.BytesIO(b'test-media'),headers=Headers({'content-type':mime}))
    result=send(db,user,file=f,attachment_type=kind,body='')
    assert getattr(result,attribute)
    response=community.media(result.id,route,db=db,user=user)
    assert response.path.read_bytes() == b'test-media'

def test_invalid_attachment_does_not_create_empty_message(db):
    with pytest.raises(HTTPException):
        send(db,User(role='admin'),file=UploadFile(filename='bad.exe',file=io.BytesIO(b'bad'),headers=Headers({'content-type':'application/octet-stream'})),attachment_type='file')
    assert db.query(TeamChannelMessage).count()==0

def test_migration_preserves_existing_messages_and_indexes():
    engine=create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    ddl=str(CreateTable(TeamChannelMessage.__table__).compile(engine)).replace('team_id INTEGER,','team_id INTEGER NOT NULL,')
    with engine.begin() as c:
        c.execute(text('DROP TABLE team_channel_messages'))
        c.execute(text(ddl))
        c.execute(text("INSERT INTO team_channel_messages (id,team_id,field_date,body,photo_path,created_at) VALUES (7,3,'2026-09-01','Keep this message','old/photo.jpg','2026-09-01 12:00:00')"))
    allow_unassigned_channel_authors(engine)
    allow_unassigned_channel_authors(engine)
    with engine.begin() as c:
        assert c.execute(text('SELECT id,body,photo_path FROM team_channel_messages')).one() == (7,'Keep this message','old/photo.jpg')
        c.execute(text("INSERT INTO team_channel_messages (field_date,body,created_at) VALUES ('2026-09-24','Admin message','2026-09-24 12:00:00')"))
    assert len(inspect(engine).get_indexes('team_channel_messages')) == len(TeamChannelMessage.__table__.indexes)
