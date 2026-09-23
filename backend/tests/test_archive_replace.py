import asyncio
import datetime as dt
import hashlib
import io
import zipfile

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image as PILImage
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.config import settings
from app.database import Base
from app.models import Image, Position, Team, Tower, User, Visit
from app.routers.images import replace_image
from app.routers.reports import oetc_line_report
from app.schemas import LineInspectionReportRequest
from app.services.oetc_report import _find_image
from app.services.docx_reports import _pick_image


def picture(color):
    data = io.BytesIO()
    PILImage.new('RGB', (80, 60), color).save(data, 'PNG')
    return data.getvalue()


@pytest.fixture
def evidence(tmp_path, monkeypatch):
    for name in ('images_dir', 'thumbnails_dir', 'reports_dir'):
        path = tmp_path / name
        path.mkdir()
        monkeypatch.setattr(settings, name, path)
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team = Team(name='Alpha')
        tower = Tower(tower_id='T-1', voltage='132')
        user = User(username='admin', role='admin', hashed_password='test', is_super_admin=True)
        db.add_all([team, tower, user]); db.flush()
        visit = Visit(tower_id=tower.id, team_id=team.id, inspection_date=dt.date(2026,9,20))
        db.add(visit); db.flush()
        pos = Position(visit_id=visit.id, ohl='OHL1', phase='R', string='S1', direction='Ashoor', installed=True)
        db.add(pos); db.flush()
        raw = picture('red')
        (settings.images_dir/'old.png').write_bytes(raw)
        (settings.images_dir/'annotation.png').write_bytes(raw)
        image = Image(position_id=pos.id, image_type='TH Full', sequence=1, image_code='T1-TH-FULL', file_path='old.png', original_filename='old.png', content_type='image/png', capture_date=dt.date(2026,9,20), checksum=hashlib.sha256(raw).hexdigest(), uploaded_at=dt.datetime(2026,9,20), annotated_path='annotation.png', annotated_uploaded_at=dt.datetime(2026,9,20), evidence_status='COMPLETE')
        db.add(image); db.commit()
        yield db, image, user


def replace(db, image, user, raw=None, checksum=None):
    file = UploadFile(filename='clearer.png', file=io.BytesIO(raw if raw is not None else picture('blue')), headers=Headers({'content-type':'image/png'}))
    return asyncio.run(replace_image(image.id, file=file, expected_checksum=checksum, db=db, user=user))


def test_replacement_keeps_slot_and_updates_pixels_without_old_markup(evidence):
    db, image, user = evidence
    identity = (image.id, image.position_id, image.image_type, image.sequence, image.image_code)
    old_checksum = image.checksum
    replace(db, image, user, checksum=old_checksum)
    assert (image.id, image.position_id, image.image_type, image.sequence, image.image_code) == identity
    assert image.checksum != old_checksum and image.original_filename == 'clearer.png'
    assert (settings.images_dir/image.file_path).read_bytes() == picture('blue')
    assert (settings.thumbnails_dir/image.thumbnail_path).exists()
    assert image.annotated_path is None and image.annotated_uploaded_at is None
    assert (settings.images_dir/'old.png').read_bytes() == picture('red')
    assert (settings.images_dir/'annotation.png').exists()


@pytest.mark.parametrize('raw', [b'not an image', b'', picture('blue')[:30]])
def test_invalid_file_never_damages_current_image(evidence, raw):
    db, image, user = evidence
    with pytest.raises(HTTPException) as exc:
        replace(db, image, user, raw=raw)
    assert exc.value.status_code == 400
    assert image.file_path == 'old.png' and image.annotated_path == 'annotation.png'
    assert (settings.images_dir/'old.png').read_bytes() == picture('red')


def test_stale_archive_refuses_to_overwrite_a_newer_replacement(evidence):
    db, image, user = evidence
    previous = image.checksum
    replace(db, image, user, checksum=previous)
    with pytest.raises(HTTPException) as exc:
        replace(db, image, user, raw=picture('green'), checksum=previous)
    assert exc.value.status_code == 409
    assert (settings.images_dir/image.file_path).read_bytes() == picture('blue')


@pytest.mark.parametrize('role,team_id', [('client',None),('team_member',1),('team_leader',999)])
def test_replacement_respects_role_and_team_scope(evidence, role, team_id):
    db, image, _ = evidence
    with pytest.raises(HTTPException) as exc:
        replace(db, image, User(role=role,team_id=team_id))
    assert exc.value.status_code == 403 and image.file_path == 'old.png'


def test_own_team_leader_can_replace(evidence):
    db, image, _ = evidence
    replace(db, image, User(role='team_leader', team_id=image.position.visit.team_id))
    assert image.original_filename == 'clearer.png'


def test_primary_selection_is_independent_of_relationship_order(evidence):
    db, image, _ = evidence
    pos = image.position
    extra = Image(position_id=pos.id,image_type='TH Full',sequence=2,file_path='extra.png')
    db.add(extra); db.flush()
    pos.images = [extra, image]
    assert _find_image(pos, 'TH Full') is image
    assert _pick_image(pos, 'TH Full', 'TH Close') is image


def test_new_report_embeds_replacement_while_saved_report_retains_old_image(evidence):
    db, image, user = evidence
    def report(number):
        return oetc_line_report(LineInspectionReportRequest(team_id=image.position.visit.team_id, tower_id=image.position.visit.tower_id, start_date=dt.date(2026,9,20), end_date=dt.date(2026,9,20), report_number=number), db=db, user=user).body
    old_report = report('BEFORE-REPLACEMENT')
    saved_files = {p:p.read_bytes() for p in settings.reports_dir.rglob('*.docx')}
    assert saved_files
    replace(db, image, user)
    new_report = report('AFTER-REPLACEMENT')
    def has_color(doc, channel):
        with zipfile.ZipFile(io.BytesIO(doc)) as z:
            for name in z.namelist():
                if name.startswith('word/media/'):
                    with PILImage.open(io.BytesIO(z.read(name))) as im:
                        pixel = im.convert('RGB').getpixel((0,0))
                        if pixel[channel] > 240 and all(v < 15 for i,v in enumerate(pixel) if i != channel):
                            return True
        return False
    assert has_color(old_report, 0)
    assert has_color(new_report, 2)
    assert all(p.read_bytes() == data for p,data in saved_files.items())
