import json
import sqlite3

import pytest

from app.services.detached_drafts import archive_detached_drafts, digest


@pytest.fixture
def source(tmp_path):
    database = tmp_path / 'app.sqlite3'
    images = tmp_path / 'images'; images.mkdir()
    (images / 'draft.jpg').write_bytes(b'exact original bytes')
    with sqlite3.connect(database) as conn:
        conn.execute('CREATE TABLE visits (id INTEGER PRIMARY KEY)')
        conn.execute('INSERT INTO visits VALUES (1)')
        conn.execute('CREATE TABLE visit_entry_drafts (id INTEGER PRIMARY KEY, visit_id INTEGER REFERENCES visits(id), payload TEXT)')
        conn.execute('CREATE TABLE visit_draft_images (id INTEGER PRIMARY KEY, draft_id INTEGER REFERENCES visit_entry_drafts(id), file_path TEXT)')
        conn.executemany('INSERT INTO visit_entry_drafts VALUES (?,?,?)', [(1,1,'active'), (2,999,'private orphan payload')])
        conn.executemany('INSERT INTO visit_draft_images VALUES (?,?,?)', [(1,1,'draft.jpg'), (2,2,'draft.jpg')])
    return database, images, tmp_path / 'private-recovery'


def test_preview_is_read_only_and_apply_requires_explicit_write_acknowledgement(source):
    database, images, archive = source
    before = digest(database)
    assert archive_detached_drafts(*source)['counts'] == {'visit_entry_drafts': 1, 'visit_draft_images': 1}
    assert digest(database) == before and not archive.exists()
    with pytest.raises(ValueError, match='Stop inspection writes'):
        archive_detached_drafts(*source, apply=True)
    assert digest(database) == before


def test_archive_keeps_exact_records_and_shared_file_and_is_repeatable(source):
    database, images, archive = source
    result = archive_detached_drafts(*source, apply=True, writes_stopped=True)
    assert result['applied']
    manifest = json.loads((archive / 'records.json').read_text())
    assert manifest['records']['visit_entry_drafts'] == [{'id':2, 'visit_id':999, 'payload':'private orphan payload'}]
    assert (archive / 'files/draft.jpg').read_bytes() == (images / 'draft.jpg').read_bytes()
    with sqlite3.connect(database) as conn:
        assert conn.execute('SELECT * FROM visit_entry_drafts').fetchall() == [(1,1,'active')]
        assert conn.execute('SELECT * FROM visit_draft_images').fetchall() == [(1,1,'draft.jpg')]
        assert not conn.execute('PRAGMA foreign_key_check').fetchall()
    assert not archive_detached_drafts(*source, apply=True, writes_stopped=True)['applied']


@pytest.mark.parametrize('path', ['missing.jpg', '../escape.jpg', '/absolute.jpg', 'C:/secret.jpg'])
def test_missing_or_unsafe_file_aborts_without_removing_any_record(source, path):
    database, images, archive = source
    with sqlite3.connect(database) as conn:
        conn.execute('UPDATE visit_draft_images SET file_path=? WHERE id=2', (path,))
    before = digest(database)
    with pytest.raises(ValueError):
        archive_detached_drafts(*source, apply=True, writes_stopped=True)
    assert digest(database) == before


def test_existing_archive_never_overwritten(source):
    source[2].mkdir()
    (source[2] / 'previous').write_text('keep')
    before = digest(source[0])
    with pytest.raises(FileExistsError):
        archive_detached_drafts(*source, apply=True, writes_stopped=True)
    assert digest(source[0]) == before
    assert (source[2] / 'previous').read_text() == 'keep'
