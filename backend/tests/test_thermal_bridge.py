import io
from datetime import datetime,timedelta
import pytest
from PIL import Image as PILImage
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base,get_db
from app.deps import get_current_user
from app.models import Image,Position,Tower,User,Visit,ThermalEditGrant
from app.routers import thermal_bridge as bridge
from app.config import settings

@pytest.fixture
def fixture(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'thermal_bridge_secret','test-bridge-key-'*4)
    monkeypatch.setattr(settings,'images_dir',tmp_path/'images');settings.images_dir.mkdir()
    monkeypatch.setattr(settings,'thumbnails_dir',tmp_path/'thumbs');settings.thumbnails_dir.mkdir()
    raw=io.BytesIO();PILImage.new('RGB',(32,24),'red').save(raw,'JPEG');(settings.images_dir/'original.jpg').write_bytes(raw.getvalue())
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user=User(id=1,username='inspector',hashed_password='unused',role='team_leader',team_id=1);db.add(user)
        tower=Tower(id=1,tower_id='T94',voltage='132 kV',area='Test');db.add(tower);db.flush()
        visit=Visit(id=1,tower_id=1,team_id=1);db.add(visit);db.flush()
        position=Position(id=1,visit_id=1,ohl='OHL1',phase='R',string='S1');db.add(position);db.flush()
        db.add(Image(id=1,position_id=1,image_type='TH Full',image_code='T94-TH',file_path='original.jpg',checksum='original',original_filename='original.jpg'));db.commit()
    def database():
        with Session(engine) as db:yield db
    def actor():
        with Session(engine) as db:return db.get(User,1)
    app=FastAPI();app.include_router(bridge.router);app.dependency_overrides[get_db]=database;app.dependency_overrides[get_current_user]=actor
    with TestClient(app) as client:yield client,engine,raw.getvalue()
    engine.dispose()

def ticket(client):
    result=client.post('/api/thermal-bridge/images/1/launch');assert result.status_code==200,result.text
    return {'ticket':result.json()['url'].split('=')[1]}

def headers():return {'X-Thermal-Service-Key':settings.thermal_bridge_secret}

def png():
    out=io.BytesIO();PILImage.new('RGB',(32,24),'blue').save(out,'PNG');return out.getvalue()

def test_roundtrip_preserves_original_and_rejects_replay(fixture):
    client,engine,original=fixture;body=ticket(client)
    assert client.post('/api/thermal-bridge/claim',json=body).status_code==403
    result=client.post('/api/thermal-bridge/claim',json=body,headers=headers());assert result.status_code==200,result.text
    assert result.json()['return_path']=='/visits/1'
    assert client.post('/api/thermal-bridge/claim',json=body,headers=headers()).status_code==410
    assert client.post('/api/thermal-bridge/source',json=body,headers=headers()).content==original
    result=client.post('/api/thermal-bridge/save',data=body,files={'file':('result.png',png(),'image/png')},headers=headers());assert result.status_code==200,result.text
    with Session(engine) as db:
        image=db.get(Image,1);saved=image.annotated_path
        assert image.file_path=='original.jpg' and image.checksum=='original'
        assert (settings.images_dir/image.file_path).read_bytes()==original
        assert (settings.images_dir/saved).read_bytes()==png()
        assert image.annotated_thumbnail_path
    # A retry does not create another file.
    assert client.post('/api/thermal-bridge/save',data=body,files={'file':('result.png',png(),'image/png')},headers=headers()).status_code==200
    with Session(engine) as db:assert db.get(Image,1).annotated_path==saved

def test_permissions_expiry_conflict_and_invalid_output(fixture):
    client,engine,_=fixture;body=ticket(client)
    with Session(engine) as db:
        db.get(User,1).team_id=2;db.commit()
    assert client.post('/api/thermal-bridge/images/1/launch').status_code==403
    assert client.post('/api/thermal-bridge/claim',json=body,headers=headers()).status_code==403
    with Session(engine) as db:db.get(User,1).team_id=1;db.commit()
    assert client.post('/api/thermal-bridge/claim',json=body,headers=headers()).status_code==200
    assert client.post('/api/thermal-bridge/save',data=body,files={'file':('x.png',b'bad','image/png')},headers=headers()).status_code==400
    with Session(engine) as db:db.get(Image,1).annotated_path='another-edit.png';db.commit()
    assert client.post('/api/thermal-bridge/save',data=body,files={'file':('x.png',png(),'image/png')},headers=headers()).status_code==409
    body=ticket(client)
    with Session(engine) as db:
        for grant in db.query(ThermalEditGrant).all():grant.expires_at=datetime.utcnow()-timedelta(seconds=1)
        db.commit()
    assert client.post('/api/thermal-bridge/claim',json=body,headers=headers()).status_code==410
    with Session(engine) as db:db.get(User,1).role='client';db.commit()
    assert client.post('/api/thermal-bridge/images/1/launch').status_code==403
