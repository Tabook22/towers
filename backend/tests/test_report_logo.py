from io import BytesIO

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.client_guard import client_role_route_guard
from app.config import settings
from app.database import Base, get_db
from app.deps import get_current_user
from app.models import AppSetting, User
from app.routers.app_settings import router
from app.security import create_access_token


@pytest.fixture
def portal(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'branding_dir', tmp_path)
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(AppSetting(id=1, app_title='Existing title', org_name_en='Customer company', splash_header='Welcome'))
        db.commit()
    actor = User(username='admin', role='admin', is_super_admin=True)
    app = FastAPI()
    app.include_router(router)
    app.middleware('http')(client_role_route_guard)
    def session():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = session
    app.dependency_overrides[get_current_user] = lambda: actor
    with TestClient(app) as client:
        yield client, actor, engine, tmp_path
    engine.dispose()


def image():
    output = BytesIO()
    Image.new('RGBA', (180, 80), (20, 100, 140, 100)).save(output, 'PNG')
    return output.getvalue()


def test_upload_replace_remove_preserves_other_branding(portal):
    client, _, engine, folder = portal
    assert client.get('/api/settings/report-logo').json() == {'logo_url': None}
    first = client.put('/api/settings/report-logo', files={'logo': ('logo.png', image(), 'image/png')})
    assert first.status_code == 200
    url = first.json()['logo_url']
    response = client.get(url)
    assert response.status_code == 200
    with Image.open(BytesIO(response.content)) as saved:
        assert saved.size == (180, 80)
        assert saved.getpixel((0, 0))[3] == 100
    second = client.put('/api/settings/report-logo', files={'logo': ('replacement.png', image(), 'image/png')})
    assert second.status_code == 200 and second.json()['logo_url'] != url
    assert len(list(folder.glob('*.png'))) == 1
    with Session(engine) as db:
        row = db.get(AppSetting, 1)
        assert (row.app_title, row.org_name_en, row.splash_header) == ('Existing title', 'Customer company', 'Welcome')
    assert client.delete('/api/settings/report-logo').json() == {'logo_url': None}
    assert client.get('/api/settings/report-logo/image').status_code == 404
    assert not list(folder.glob('*.png'))


@pytest.mark.parametrize('data', [b'not an image', b'<svg></svg>', b'x' * (5 * 1024 * 1024 + 1)], ids=['invalid', 'svg', 'oversized'])
def test_rejects_invalid_and_oversized_uploads_without_changing_logo(portal, data):
    client, _, _, folder = portal
    assert client.put('/api/settings/report-logo', files={'logo': ('logo.png', image(), 'image/png')}).status_code == 200
    before = client.get('/api/settings/report-logo').json()
    assert client.put('/api/settings/report-logo', files={'logo': ('bad.png', data, 'image/png')}).status_code == 400
    assert client.get('/api/settings/report-logo').json() == before
    assert len(list(folder.glob('*.png'))) == 1


def test_customer_can_read_report_logo_but_cannot_change_settings(portal):
    client, actor, _, _ = portal
    url = client.put('/api/settings/report-logo', files={'logo': ('logo.png', image(), 'image/png')}).json()['logo_url']
    actor.role = 'client'
    actor.is_super_admin = False
    client.headers['Authorization'] = 'Bearer ' + create_access_token('customer', 'client')
    assert client.get('/api/settings/report-logo').status_code == 200
    assert client.get(url).status_code == 200
    assert client.put('/api/settings/report-logo', files={'logo': ('logo.png', image(), 'image/png')}).status_code == 403
    assert client.delete('/api/settings/report-logo').status_code == 403
    assert client.get('/api/settings/branding').status_code == 403


def test_admin_without_settings_permission_cannot_change_logo(portal):
    client, actor, _, _ = portal
    actor.is_super_admin = False
    assert client.put('/api/settings/report-logo', files={'logo': ('logo.png', image(), 'image/png')}).status_code == 403
