import datetime as dt
import io
import zipfile

import pytest
from docx import Document
from lxml import etree
from PIL import Image as PILImage
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.database import Base
from app.migrations import add_missing_columns, backfill_report_image_selection
from app.models import Image, Position, ReportImage, User, Visit
from app.routers.images import update_image
from app.routers.reports import oetc_line_report
from app.schemas import ImageUpdate, LineInspectionReportRequest
from app.services.oetc_report import used_image_ids
from app.services.report_images import selected_images
from tests.test_oetc_report import _seed


def test_selected_extras_render_and_snapshot_while_unchecked_images_stay_in_archive(tmp_path, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, 'images_dir', tmp_path)
    monkeypatch.setattr(settings, 'reports_dir', tmp_path / 'reports')
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team, tower, _ = _seed(db)
        pos = db.query(Position).join(Visit).filter(Visit.tower_id == tower.id).one()
        admin = User(username='admin', role='admin', hashed_password='x')
        db.add(admin)
        images = []
        for seq, color in enumerate(['red', 'green', 'blue'], 1):
            name = f'{color}.jpg'
            PILImage.new('RGB', (40, 30), color).save(tmp_path / name)
            image = Image(position_id=pos.id, image_type='TH Full', sequence=seq, file_path=name)
            db.add(image)
            images.append(image)
        db.commit()
        # Legacy choices keep only the first image until the user changes the checkboxes.
        assert selected_images(pos) == [images[0]]
        update_image(images[0].id, ImageUpdate(include_in_report=False), db, admin)
        assert selected_images(pos) == []  # no automatic fallback to an unchecked extra
        for image in images[1:]:
            update_image(image.id, ImageUpdate(include_in_report=True), db, admin)
        db.expire_all()
        assert {i.id for i in selected_images(pos)} == {i.id for i in images[1:]}
        payload = LineInspectionReportRequest(team_id=team.id, tower_id=tower.id,
            start_date=dt.date(2026, 9, 1), end_date=dt.date(2026, 9, 30), report_number='CHOICES-1')
        response = oetc_line_report(payload, db, admin)
        assert {r.image_id for r in db.query(ReportImage).all()} == {i.id for i in images[1:]}
        assert len(used_image_ids([pos.visit])) == 2
        # Parse the real generated Word file, including multiple images in the same type's cell.
        doc = Document(io.BytesIO(response.body))
        assert len(doc.inline_shapes) >= 2
        with zipfile.ZipFile(io.BytesIO(response.body)) as package:
            etree.fromstring(package.read('word/document.xml'))
            colors = []
            for path in package.namelist():
                if path.startswith('word/media/'):
                    with PILImage.open(io.BytesIO(package.read(path))) as picture:
                        if picture.size == (40, 30):
                            colors.append(picture.convert('RGB').getpixel((0, 0)))
        assert len(colors) == 2
        assert all(red < 10 for red, green, blue in colors)  # excluded red photo is absent
        saved = next((tmp_path / 'reports').rglob('*.docx')).read_bytes()
        for image in images:
            update_image(image.id, ImageUpdate(include_in_report=False), db, admin)
        assert selected_images(pos) == []
        assert db.query(Image).count() == 3
        assert all((tmp_path / image.file_path).exists() for image in images)
        assert next((tmp_path / 'reports').rglob('*.docx')).read_bytes() == saved
        assert db.query(ReportImage).count() == 2


def test_additive_migration_preserves_legacy_choices_and_explicit_exclusions():
    engine = create_engine('sqlite:///:memory:')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE images (id INTEGER PRIMARY KEY, position_id INTEGER, image_type TEXT, sequence INTEGER, file_path TEXT, evidence_status TEXT, updated_at DATETIME)'))
        conn.execute(text("INSERT INTO images VALUES (1, 1, 'TH Full', 1, NULL, 'COMPLETE', '2026-09-01'), (2, 1, 'TH Full', 2, 'extra.jpg', 'COMPLETE', '2026-09-01')"))
    add_missing_columns(engine, Base)
    backfill_report_image_selection(engine)
    with Session(engine) as db:
        images = db.query(Image).all()
        pos = Position(images=images)
        assert selected_images(pos) == [images[1]]
    with engine.begin() as conn:
        conn.execute(text('UPDATE images SET include_in_report=0 WHERE id=2'))
    add_missing_columns(engine, Base)
    backfill_report_image_selection(engine)
    with Session(engine) as db:
        assert selected_images(Position(images=db.query(Image).all())) == []


def test_null_cannot_reset_an_explicit_report_choice():
    with pytest.raises(ValueError):
        ImageUpdate(include_in_report=None)


def test_selection_follows_photo_when_promoted_or_retyped(tmp_path, monkeypatch):
    import asyncio
    from app.config import settings
    from app.routers.images import make_primary, retype_image
    from app.schemas import ImageRetype
    monkeypatch.setattr(settings, 'images_dir', tmp_path)
    monkeypatch.setattr(settings, 'thumbnails_dir', tmp_path / 'thumbs')
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        _, tower, _ = _seed(db)
        pos = db.query(Position).join(Visit).filter(Visit.tower_id == tower.id).one()
        admin = User(username='admin', role='admin', hashed_password='x')
        db.add(admin)
        for seq, color in enumerate(['red', 'blue'], 1):
            PILImage.new('RGB', (40, 30), color).save(tmp_path / f'{color}.jpg')
            db.add(Image(position_id=pos.id, image_type='TH Full', sequence=seq,
                image_code=f'PHOTO-{seq}', file_path=f'{color}.jpg', original_filename=f'{color}.jpg',
                content_type='image/jpeg', include_in_report=(seq == 2)))
        db.commit()
        primary, extra = sorted(pos.images, key=lambda image: image.sequence)
        asyncio.run(make_primary(extra.id, db, admin))
        assert primary.include_in_report is True
        assert extra.include_in_report is False
        assert selected_images(pos) == [primary]
        moved = retype_image(primary.id, ImageRetype(new_type='RGB Close'), db, admin)
        assert moved.include_in_report is True
        db.expire_all()
        assert selected_images(pos) == [moved]


def test_other_team_cannot_change_report_selection():
    from fastapi import HTTPException
    from app.models import Team
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        _seed(db)
        other = Team(name='Other team')
        db.add(other)
        db.flush()
        leader = User(username='other', hashed_password='x', role='team_leader', team_id=other.id)
        image = Image(position_id=db.query(Position).first().id, image_type='TH Full', file_path='photo.jpg')
        db.add_all([leader, image])
        db.commit()
        with pytest.raises(HTTPException) as error:
            update_image(image.id, ImageUpdate(include_in_report=False), db, leader)
        assert error.value.status_code == 403
        assert image.include_in_report is True
