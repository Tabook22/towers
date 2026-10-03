import asyncio
import datetime as dt
import io

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image
from starlette.datastructures import Headers
from tests.test_visit_entry import db, files
from app.models import Team, TeamArchiveImage, User
from app.config import settings
from app.routers import team_archive as archive


def setup(db):
    team = Team(name='Folder crew')
    db.add(team); db.commit()
    return team, db.query(User).first()


def photo(name='same.jpg', kind='image/jpeg'):
    raw = io.BytesIO()
    Image.new('RGB', (10, 10), 'blue').save(raw, format='JPEG')
    raw.seek(0)
    return UploadFile(filename=name, file=raw, headers=Headers({'content-type': kind}))


def test_upload_date_uses_oman_calendar_boundary():
    assert archive.archive_upload_date(dt.datetime(2026, 12, 31, 20, 1)) == dt.date(2027, 1, 1)
    assert archive.archive_upload_date(dt.datetime(2026, 12, 31, 19, 59, tzinfo=dt.timezone.utc)) == dt.date(2026, 12, 31)


def test_capture_date_preserved_but_upload_controls_filing_and_filter(db, files, monkeypatch):
    team, user = setup(db)
    monkeypatch.setattr(archive, 'extract_exif_gps_datetime', lambda raw: {'capture_date': dt.date(2001, 1, 2)})
    output = asyncio.run(archive.upload_team_archive_images(team.id, [photo(), photo()], 'batch', [], db, user))
    assert len(output) == 2 and output[0].upload_date == output[1].upload_date
    assert all(row.capture_date == dt.date(2001, 1, 2) for row in output)
    rows = db.query(TeamArchiveImage).all()
    assert rows[0].file_path != rows[1].file_path
    day = output[0].upload_date
    assert all(row.file_path.startswith(f'team_archive/{day.year}/{day.month:02}/{day.day:02}/team-{team.id}/') for row in rows)
    assert len(archive.list_team_archive_images(db, user, team.id, day.year, day.month, day.day)) == 2
    assert not archive.list_team_archive_images(db, user, team.id, 2001, 1, 2)
    other = User(username='other-crew', hashed_password='unused', role='team_leader', team_id=None)
    assert not archive.list_team_archive_images(db, other, team.id)


def test_unsupported_later_file_leaves_no_partial_upload(db, files):
    team, user = setup(db)
    with pytest.raises(HTTPException):
        asyncio.run(archive.upload_team_archive_images(team.id, [photo(), photo('notes.txt', 'text/plain')], None, [], db, user))
    assert db.query(TeamArchiveImage).count() == 0
    assert not list(settings.images_dir.rglob('*.jpg'))


def test_fake_image_in_later_file_rejects_entire_batch(db, files):
    team, user = setup(db)
    fake = UploadFile(filename='fake.jpg', file=io.BytesIO(b'not image pixels'), headers=Headers({'content-type': 'image/jpeg'}))
    with pytest.raises(HTTPException) as error:
        asyncio.run(archive.upload_team_archive_images(team.id, [photo(), fake], None, [], db, user))
    assert error.value.status_code == 422
    assert db.query(TeamArchiveImage).count() == 0
    assert not list(settings.images_dir.rglob('*.jpg'))


def test_oversized_image_rejects_entire_batch(db, files, monkeypatch):
    team, user = setup(db)
    monkeypatch.setattr(settings, 'max_upload_size_mb', 1)
    oversized = UploadFile(filename='huge.jpg', file=io.BytesIO(b'x' * (1024 * 1024 + 1)), headers=Headers({'content-type': 'image/jpeg'}))
    with pytest.raises(HTTPException) as error:
        asyncio.run(archive.upload_team_archive_images(team.id, [photo(), oversized], None, [], db, user))
    assert error.value.status_code == 413
    assert db.query(TeamArchiveImage).count() == 0
    assert not list(settings.images_dir.rglob('*.jpg'))


def test_storage_failure_rolls_back_records_and_files(db, files, monkeypatch):
    team, user = setup(db)
    original = archive.save_upload
    count = 0
    def fail_second(*args):
        nonlocal count
        count += 1
        if count == 2:
            raise OSError('disk full')
        return original(*args)
    monkeypatch.setattr(archive, 'save_upload', fail_second)
    with pytest.raises(OSError):
        asyncio.run(archive.upload_team_archive_images(team.id, [photo(), photo()], None, [], db, user))
    assert db.query(TeamArchiveImage).count() == 0
    assert not list(settings.images_dir.rglob('*.jpg'))
    assert not list(settings.thumbnails_dir.rglob('*.jpg'))


def test_folder_relative_paths_are_returned_without_becoming_storage_paths(db, files):
    team, user = setup(db)
    output = asyncio.run(archive.upload_team_archive_images(
        team.id,
        [photo('image.jpg'), photo('image.jpg')],
        None,
        ['Main folder/Phase R/image.jpg', 'Main folder/Phase R/subfolder/image.jpg'],
        db,
        user,
    ))
    assert [row.relative_path for row in output] == [
        'Main folder/Phase R/image.jpg',
        'Main folder/Phase R/subfolder/image.jpg',
    ]
    assert [row.original_filename for row in output] == ['image.jpg', 'image.jpg']
    assert all(row.file_path.startswith('team_archive/') for row in db.query(TeamArchiveImage).all())


def test_folder_path_traversal_components_are_removed(db, files):
    team, user = setup(db)
    output = asyncio.run(archive.upload_team_archive_images(
        team.id,
        [photo('image.jpg')],
        None,
        ['Main/../Phase R/image.jpg'],
        db,
        user,
    ))
    assert output[0].relative_path == 'Main/Phase R/image.jpg'
