import asyncio
import datetime as dt
import io
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image as PillowImage
from starlette.datastructures import Headers

from tests.test_visit_workflow import db, make_visit
from app.config import settings
from app.models import Image, Position, User, VisitDraftImage, VisitEntryDraft
from app.schemas import PositionUpdate
from app.routers.positions import update_position
from app.routers.visit_entry import DraftWrite, DraftCommit, DraftRevision, get_entry, save_entry, commit_entry, upload_draft_image, draft_image, discard_entry
from app.services.rollup import visit_rollup
from app.services.position_workflow import reportable_position


def patch(position, **changes):
    return {'before': {'id': position.id, 'updated_at': position.updated_at.isoformat(), 'direction': position.direction}, 'changes': changes}


def save(db, visit, user, payload):
    original = get_entry(visit.id, db, user)
    return save_entry(visit.id, DraftWrite(revision=original['revision'], payload=payload), db, user)


def confirm(db, visit, user, revision, token=None):
    return asyncio.run(commit_entry(visit.id, DraftCommit(revision=revision, token=token or uuid4()), db, user))


@pytest.fixture
def files(tmp_path, monkeypatch):
    for name in ['images_dir', 'thumbnails_dir', 'voice_notes_dir']:
        path = tmp_path / name; path.mkdir()
        monkeypatch.setattr(settings, name, path)
    return tmp_path


def upload(db, visit, user, key, revision, token=None, kind='RGB Full', expected=None):
    raw = io.BytesIO()
    if kind == 'Voice note':
        raw.write(b'preview recording')
        content_type, filename = 'audio/webm', 'recording.webm'
    else:
        PillowImage.new('RGB', (20, 20), 'blue').save(raw, format='JPEG')
        content_type, filename = 'image/jpeg', 'sample.jpg'
    raw.seek(0)
    return asyncio.run(upload_draft_image(visit_id=visit.id, position_key=key, image_type=kind,
        token=token or uuid4(), expected_updated_at=expected, revision=revision, duration_seconds=3.0,
        file=UploadFile(filename=filename, file=raw, headers=Headers({'content-type': content_type})), db=db, user=user))


def test_one_confirmation_commits_header_positions_layout_and_evidence(db, files):
    visit, user = make_visit(db)
    position = visit.positions[0]
    before = visit_rollup(visit)
    state = save(db, visit, user, {'headerDraft': {'inspector_name': 'Field inspector'},
        'headerBefore': {'updated_at': visit.updated_at.isoformat()},
        'drafts': {str(position.id): patch(position, direction='Ashoor', mount_type='Suspension', string_count='Single', inspector_notes='Exact R position')},
        'additions': [{'id': -1, 'ohl': 'OHL1', 'phase': 'R', 'string': 'S2', 'direction': 'Saada', 'mount_type': 'Tension', 'string_count': 'Double', 'inspector_notes': 'Other direction'}],
        'layoutIds': [position.id, -1], 'layoutVersions': {str(p.id): p.updated_at.isoformat() for p in visit.positions}, 'saveTemplate': True})
    upload(db, visit, user, -1, state['revision'])
    db.refresh(visit)
    assert visit.inspector_name is None
    assert visit_rollup(visit) == before
    assert not any(reportable_position(p) for p in visit.positions)
    assert not db.query(Image).filter(Image.file_path.isnot(None)).count()
    result = confirm(db, visit, user, state['revision'])
    assert result.inspector_name == 'Field inspector'
    assert result.rollup.possible_positions == 2
    created = next(p for p in result.positions if p.direction == 'Saada')
    assert created.inspector_notes == 'Other direction'
    assert sum(bool(i.file_path) for i in created.images) == 1
    assert next(p for p in result.positions if p.id == position.id).inspector_notes == 'Exact R position'
    assert len(result.tower.inspection_layout) == 2
    assert get_entry(visit.id, db, user)['payload'] == {}


def test_invalid_last_position_rolls_back_header_and_all_prior_changes(db):
    visit, user = make_visit(db)
    first, last = visit.positions[:2]
    state = save(db, visit, user, {'headerDraft': {'inspector_name': 'Must not persist'}, 'headerBefore': {'updated_at': visit.updated_at.isoformat()},
        'drafts': {str(first.id): patch(first, inspector_notes='Must roll back'), str(last.id): patch(last, string='S2', string_count='Single')}})
    with pytest.raises(HTTPException) as error:
        confirm(db, visit, user, state['revision'])
    assert error.value.status_code == 422
    db.refresh(visit); db.refresh(first)
    assert visit.inspector_name is None and first.inspector_notes is None
    assert get_entry(visit.id, db, user)['payload']['drafts']


def test_stale_draft_never_overwrites_other_inspector_or_header(db):
    visit, user = make_visit(db); position = visit.positions[0]
    state = save(db, visit, user, {'drafts': {str(position.id): patch(position, inspector_notes='Draft')}})
    update_position(position.id, PositionUpdate(inspector_notes='Other inspector'), db, user)
    with pytest.raises(HTTPException) as error:
        confirm(db, visit, user, state['revision'])
    assert error.value.status_code == 409
    db.refresh(position); assert position.inspector_notes == 'Other inspector'


def test_upload_and_confirmation_retries_are_idempotent(db, files):
    visit, user = make_visit(db); position = visit.positions[0]
    state = save(db, visit, user, {'drafts': {str(position.id): patch(position, direction='Ashoor', mount_type='Suspension', string_count='Single')}})
    token = uuid4()
    first = upload(db, visit, user, position.id, state['revision'], token, expected=position.updated_at)
    second = upload(db, visit, user, position.id, state['revision'], token, expected=position.updated_at)
    assert first['images'] == second['images'] and len(first['images']) == 1
    commit_token = uuid4()
    result = confirm(db, visit, user, state['revision'], commit_token)
    again = confirm(db, visit, user, state['revision'], commit_token)
    assert len(result.positions) == len(again.positions)
    assert db.query(Image).filter(Image.file_path.isnot(None)).count() == 1


def test_drafts_private_cross_visit_images_rejected_and_old_draft_revision_rejected(db, files):
    visit, user = make_visit(db)
    other = User(username='other-inspector', hashed_password='unused', role='admin')
    db.add(other); db.commit()
    state = save(db, visit, user, {'headerDraft': {'inspector_name': 'Private'}, 'additions': [
        {'id': -1, 'ohl': 'OHL1', 'phase': 'R', 'string': 'S1', 'direction': 'Saada', 'mount_type': 'Tension', 'string_count': 'Single'}]})
    assert get_entry(visit.id, db, other)['payload'] == {}
    with pytest.raises(HTTPException) as error:
        save_entry(visit.id, DraftWrite(revision=0, payload={'different': True}), db, user)
    assert error.value.status_code == 409
    staged = upload(db, visit, user, -1, state['revision'])
    with pytest.raises(HTTPException) as error:
        draft_image(visit.id, staged['images'][0]['id'], db, other)
    assert error.value.status_code == 404
    another, _ = make_visit(db)
    with pytest.raises(HTTPException) as error:
        upload(db, visit, user, another.positions[0].id, state['revision'], expected=another.positions[0].updated_at)
    assert error.value.status_code == 422


def test_discard_preserves_confirmed_evidence_and_draft_images_never_reported(db, files):
    visit, user = make_visit(db); position = visit.positions[0]
    state = save(db, visit, user, {'drafts': {str(position.id): patch(position, direction='Ashoor')}})
    upload(db, visit, user, position.id, state['revision'], expected=position.updated_at)
    original_count = db.query(Image).count()
    discarded = discard_entry(visit.id, DraftRevision(revision=state['revision']), db, user)
    assert discarded['payload'] == {} and discarded['images'] == []
    assert db.query(Image).count() == original_count
    assert position.direction is None


def test_omitting_recorded_position_rejects_entire_layout(db):
    visit, user = make_visit(db); position = visit.positions[0]
    position.inspector_notes = 'Preserve me'; db.commit()
    state = save(db, visit, user, {'layoutIds': [visit.positions[1].id], 'layoutVersions': {str(p.id): p.updated_at.isoformat() for p in visit.positions}})
    with pytest.raises(HTTPException) as error:
        confirm(db, visit, user, state['revision'])
    assert error.value.status_code == 409
    assert all(p.in_scope for p in visit.positions)


def test_voice_draft_stays_with_new_position_until_confirmation(db, files):
    visit, user = make_visit(db)
    state = save(db, visit, user, {'additions': [{'id': -1, 'ohl': 'OHL1', 'phase': 'R', 'string': 'S1', 'direction': 'Saada', 'mount_type': 'Tension', 'string_count': 'Single'}]})
    upload(db, visit, user, -1, state['revision'], kind='Voice note')
    assert not any(p.voice_note_path for p in visit.positions)
    result = confirm(db, visit, user, state['revision'])
    voices = [p for p in result.positions if p.voice_note_path]
    assert len(voices) == 1 and voices[0].direction == 'Saada'
    assert voices[0].voice_note_duration_seconds == 3.0


def test_identical_photo_with_new_token_is_reused_only_for_the_same_position_and_category(db, files):
    visit, user = make_visit(db); first, second = visit.positions[:2]
    state = save(db, visit, user, {'drafts': {
        str(first.id): patch(first, direction='Ashoor'), str(second.id): patch(second, direction='Ashoor')}})
    a = upload(db, visit, user, first.id, state['revision'], expected=first.updated_at)
    b = upload(db, visit, user, first.id, state['revision'], expected=first.updated_at)
    assert a['images'] == b['images'] and len(b['images']) == 1
    c = upload(db, visit, user, second.id, state['revision'], expected=second.updated_at)
    assert len(c['images']) == 2
    d = upload(db, visit, user, first.id, state['revision'], kind='TH Full', expected=first.updated_at)
    assert len(d['images']) == 3
    assert db.query(VisitDraftImage).count() == 3


def test_review_snapshot_rejects_evidence_added_after_review_atomically(db, files):
    visit, user = make_visit(db); position = visit.positions[0]
    state = save(db, visit, user, {'drafts': {str(position.id): patch(position, direction='Ashoor', inspector_notes='Draft note')}})
    first = upload(db, visit, user, position.id, state['revision'], expected=position.updated_at)
    reviewed = [image['id'] for image in first['images']]
    latest = upload(db, visit, user, position.id, state['revision'], kind='TH Full', expected=position.updated_at)
    with pytest.raises(HTTPException) as error:
        asyncio.run(commit_entry(visit.id, DraftCommit(revision=state['revision'], token=uuid4(), reviewed_image_ids=reviewed), db, user))
    assert error.value.status_code == 409
    db.refresh(position); assert position.inspector_notes is None
    assert len(get_entry(visit.id, db, user)['images']) == 2
    result = asyncio.run(commit_entry(visit.id, DraftCommit(revision=state['revision'], token=uuid4(), reviewed_image_ids=[image['id'] for image in latest['images']]), db, user))
    assert next(p for p in result.positions if p.id == position.id).inspector_notes == 'Draft note'


@pytest.mark.parametrize('payload', [{'drafts': []}, {'additions': {}}, {'drafts': {'1': []}}, {'additions': [{'id': 1}]}, {'excludedImages': ['1']}])
def test_malformed_draft_collections_are_rejected_before_save(db, payload):
    visit, user = make_visit(db)
    with pytest.raises(HTTPException) as error:
        save(db, visit, user, payload)
    assert error.value.status_code == 422
    assert get_entry(visit.id, db, user)['payload'] == {}


def test_unlinked_negative_evidence_key_is_rejected_immediately(db, files):
    visit, user = make_visit(db)
    state = get_entry(visit.id, db, user)
    with pytest.raises(HTTPException) as error:
        upload(db, visit, user, -999, state['revision'])
    assert error.value.status_code == 422
    assert not db.query(VisitDraftImage).count()


def test_dji_mpo_jpeg_can_be_confirmed_without_rewriting_original(db, files):
    visit, user = make_visit(db)
    position = visit.positions[0]
    state = save(db, visit, user, {'drafts': {str(position.id): patch(position, direction='Ashoor')}})
    stream = io.BytesIO()
    PillowImage.new('RGB', (20, 20), 'blue').save(stream, format='MPO', save_all=True,
        append_images=[PillowImage.new('RGB', (20, 20), 'red')])
    original = stream.getvalue()
    with PillowImage.open(io.BytesIO(original)) as picture:
        assert picture.format == 'MPO'
    stream.seek(0)
    asyncio.run(upload_draft_image(visit_id=visit.id, position_key=position.id, image_type='TH Full',
        token=uuid4(), expected_updated_at=position.updated_at, revision=state['revision'], duration_seconds=None,
        file=UploadFile(filename='DJI_thermal.JPG', file=stream, headers=Headers({'content-type': 'image/jpeg'})), db=db, user=user))
    result = confirm(db, visit, user, state['revision'])
    image = next(i for p in result.positions for i in p.images if i.file_path)
    assert (settings.images_dir / image.file_path).read_bytes() == original
    assert image.thumbnail_path


@pytest.mark.parametrize('format', ['GIF', 'BMP'])
def test_unsupported_image_is_rejected_before_it_enters_draft(db, files, format):
    visit, user = make_visit(db)
    position = visit.positions[0]
    state = get_entry(visit.id, db, user)
    stream = io.BytesIO()
    PillowImage.new('RGB', (20, 20)).save(stream, format=format)
    stream.seek(0)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(upload_draft_image(visit_id=visit.id, position_key=position.id, image_type='RGB Full',
            token=uuid4(), expected_updated_at=position.updated_at, revision=state['revision'], duration_seconds=None,
            file=UploadFile(filename='wrong.jpg', file=stream, headers=Headers({'content-type': 'image/jpeg'})), db=db, user=user))
    assert exc.value.status_code == 422
    assert 'wrong.jpg' in exc.value.detail
    db.rollback()
    assert not get_entry(visit.id, db, user)['images']
