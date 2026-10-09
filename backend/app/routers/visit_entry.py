"""Autosaved working copies and a single atomic confirmation for visit entry."""
import datetime as dt
import hashlib
import json
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, TypeAdapter, ValidationError
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import IMAGE_TYPE_CHOICES, Image, Position, User, Visit, VisitEntryDraft, VisitDraftImage
from app.routers.visits import _load_visit, _check_workflow_access, _validate_assigned_member, attach_rollup
from app.routers.positions import apply_position_update, claim_position_version
from app.routers.images import apply_upload, ACCEPTED_CONTENT_TYPES
from app.routers.teams import ACCEPTED_AUDIO_TYPES
from app.schemas import PositionCreate, PositionUpdate, VisitUpdate, VisitDetail
from app.services.archive import file_extension, save_upload, validate_image_bytes
from app.services.codes import refresh_position_codes, position_image_code
from app.services.position_workflow import has_observations

router = APIRouter(prefix='/api/visits/{visit_id}/entry', tags=['visit entry'])


class DraftWrite(BaseModel):
    revision: int = Field(ge=0)
    payload: dict


class DraftCommit(BaseModel):
    revision: int = Field(ge=0)
    token: UUID
    reviewed_image_ids: list[int] | None = None


class DraftRevision(BaseModel):
    revision: int = Field(ge=0)


def working_copy(db, visit_id, user):
    visit = _load_visit(db, visit_id)
    _check_workflow_access(visit, user)
    draft = db.query(VisitEntryDraft).filter_by(visit_id=visit_id, user_id=user.id).first()
    if draft is None:
        draft = VisitEntryDraft(visit_id=visit_id, user_id=user.id, payload={}, revision=0)
        db.add(draft)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            draft = db.query(VisitEntryDraft).filter_by(visit_id=visit_id, user_id=user.id).one()
    return visit, draft


def output(db, draft):
    images = db.query(VisitDraftImage).filter_by(draft_id=draft.id, consumed=False).order_by(VisitDraftImage.id).all()
    return {'revision': draft.revision, 'payload': draft.payload, 'images': [
        {'id': i.id, 'position_key': i.position_key, 'image_type': i.image_type, 'filename': i.filename, 'checksum': i.checksum}
        for i in images]}


def claim(db, draft, revision):
    result = db.execute(update(VisitEntryDraft).where(VisitEntryDraft.id == draft.id, VisitEntryDraft.revision == revision)
                        .values(revision=revision + 1).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, 'This draft changed in another tab or device. Your local copy is retained. Reload the server draft before continuing.')
    db.refresh(draft)


def validate_envelope(payload):
    """Reject malformed collections before they can poison an autosaved working copy."""
    for key in ('drafts', 'layoutVersions'):
        if key in payload and not isinstance(payload[key], dict):
            raise HTTPException(422, f'{key} must be an object')
    for key in ('headerDraft', 'headerBefore'):
        if payload.get(key) is not None and not isinstance(payload[key], dict):
            raise HTTPException(422, f'{key} must be an object')
    for key in ('additions', 'excludedImages', 'layoutIds'):
        if payload.get(key) is not None and not isinstance(payload[key], list):
            raise HTTPException(422, f'{key} must be a list')
    for key in ('excludedImages', 'layoutIds'):
        if any(type(value) is not int for value in payload.get(key) or []):
            raise HTTPException(422, f'{key} must contain position or evidence IDs')
    for key, value in payload.get('drafts', {}).items():
        if not str(key).lstrip('-').isdigit() or not isinstance(value, dict) or not isinstance(value.get('before'), dict) or not isinstance(value.get('changes'), dict):
            raise HTTPException(422, 'Each position draft needs an ID, saved values and proposed changes')
    ids = []
    for addition in payload.get('additions', []):
        if not isinstance(addition, dict) or type(addition.get('id')) is not int or addition['id'] >= 0:
            raise HTTPException(422, 'Each new position needs a unique negative draft ID')
        ids.append(addition['id'])
    if len(ids) != len(set(ids)):
        raise HTTPException(422, 'New position draft IDs must be unique')


@router.get('')
def get_entry(visit_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _, draft = working_copy(db, visit_id, user)
    return output(db, draft)


@router.put('')
def save_entry(visit_id: int, body: DraftWrite, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    validate_envelope(body.payload)
    if len(json.dumps(body.payload)) > 5_000_000:
        raise HTTPException(413, 'Draft is too large')
    _, draft = working_copy(db, visit_id, user)
    # An ambiguous successful response may be retried without duplicating or losing edits.
    if draft.revision == body.revision + 1 and draft.payload == body.payload:
        return output(db, draft)
    claim(db, draft, body.revision)
    draft.payload = body.payload
    db.commit()
    return output(db, draft)


@router.post('/images')
async def upload_draft_image(visit_id: int, position_key: int = Form(...), image_type: str = Form(...),
                             token: UUID = Form(...), expected_updated_at: dt.datetime | None = Form(None),
                             revision: int = Form(...), duration_seconds: float | None = Form(None),
                             file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit, draft = working_copy(db, visit_id, user)
    content_type = (file.content_type or '').split(';')[0].strip().lower()
    voice = image_type == 'Voice note'
    if (voice and content_type not in ACCEPTED_AUDIO_TYPES) or (not voice and (image_type not in IMAGE_TYPE_CHOICES or content_type not in ACCEPTED_CONTENT_TYPES)):
        raise HTTPException(422, 'Choose a valid evidence category and image file')
    if position_key > 0 and not any(p.id == position_key for p in visit.positions):
        raise HTTPException(422, 'Position does not belong to this visit')
    if position_key == 0 or (position_key > 0 and expected_updated_at is None):
        raise HTTPException(422, 'Position identity and saved revision are required')
    raw = await file.read(settings.max_upload_size_mb * 1024 * 1024 + 1)
    if len(raw) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(413, 'Image exceeds the upload limit')
    checksum = hashlib.sha256(raw).hexdigest()
    # Serialize retries with confirmation so a late upload cannot attach to the next draft.
    db.execute(update(VisitEntryDraft).where(VisitEntryDraft.id == draft.id).values(revision=VisitEntryDraft.revision))
    prior = db.query(VisitDraftImage).filter_by(token=str(token)).first()
    if prior:
        if (prior.draft_id, prior.position_key, prior.image_type, prior.checksum) != (draft.id, position_key, image_type, checksum):
            raise HTTPException(409, 'Upload token belongs to different evidence')
        db.commit()
        return output(db, draft)
    db.refresh(draft)
    if draft.revision != revision:
        raise HTTPException(409, 'The working draft changed while this upload was starting. Retry from the current draft.')
    validate_envelope(draft.payload)
    if position_key < 0 and not any(p['id'] == position_key for p in draft.payload.get('additions', [])):
        raise HTTPException(422, 'Choose a position in the current working draft before attaching evidence')
    if not raw:
        raise HTTPException(422, 'The file is empty')
    if not voice:
        try:
            validate_image_bytes(raw)
        except Exception:
            raise HTTPException(422, f'{file.filename or "Image"}: this file could not be read as a supported image')
        duplicate = db.query(VisitDraftImage).filter_by(draft_id=draft.id, position_key=position_key,
            image_type=image_type, checksum=checksum, consumed=False).filter(~VisitDraftImage.id.in_(draft.payload.get('excludedImages', []))).first()
        confirmed = position_key > 0 and db.query(Image.id).filter_by(position_id=position_key, image_type=image_type, checksum=checksum).filter(Image.file_path.isnot(None)).first()
        if duplicate or confirmed:
            db.commit()
            return output(db, draft)
    relative = f'draft-evidence/{visit_id}/{user.id}/{token}{file_extension(file.filename, content_type)}'
    save_upload(raw, relative)
    db.add(VisitDraftImage(draft_id=draft.id, token=str(token), position_key=position_key,
        expected_position_updated_at=expected_updated_at, image_type=image_type,
        filename=(file.filename or 'Evidence')[:300], content_type=content_type, file_path=relative, checksum=checksum, duration_seconds=duration_seconds))
    db.commit()
    return output(db, draft)


@router.post('/discard')
def discard_entry(visit_id: int, body: DraftRevision, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _, draft = working_copy(db, visit_id, user)
    claim(db, draft, body.revision)
    draft.payload = {}
    for image in db.query(VisitDraftImage).filter_by(draft_id=draft.id, consumed=False):
        image.consumed = True
    db.commit()
    return output(db, draft)


@router.get('/images/{image_id}')
def draft_image(visit_id: int, image_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _, draft = working_copy(db, visit_id, user)
    image = db.query(VisitDraftImage).filter_by(id=image_id, draft_id=draft.id, consumed=False).first()
    if not image:
        raise HTTPException(404, 'Draft image not found')
    return FileResponse(settings.images_dir / image.file_path, media_type=image.content_type)


def timestamp(value):
    return TypeAdapter(dt.datetime).validate_python(value).replace(tzinfo=None)


@router.post('/commit', response_model=VisitDetail)
async def commit_entry(visit_id: int, body: DraftCommit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit, draft = working_copy(db, visit_id, user)
    if draft.last_commit_token == str(body.token):
        return attach_rollup(visit, detail=True)
    try:
        claim(db, draft, body.revision)
        data = draft.payload
        validate_envelope(data)
        by_id = {p.id: p for p in visit.positions}
        staged = db.query(VisitDraftImage).filter_by(draft_id=draft.id, consumed=False).order_by(VisitDraftImage.id).all()
        if body.reviewed_image_ids is not None and set(body.reviewed_image_ids) != {image.id for image in staged}:
            raise HTTPException(409, 'Draft evidence changed after review. Reopen the review to confirm the current files.')
        excluded_images = set(data.get('excludedImages', []))
        retained = [i for i in staged if i.id not in excluded_images]
        changes = data.get('drafts', {})
        additions = data.get('additions', [])
        if len(changes) + len(additions) > 240:
            raise HTTPException(422, 'At most 240 position changes can be confirmed together')
        versions = {int(k): timestamp(v['before']['updated_at']) for k, v in changes.items() if int(k) > 0}
        layout = data.get('layoutIds')
        if layout is not None:
            layout_versions = {int(k): timestamp(v) for k, v in data.get('layoutVersions', {}).items()}
            if set(layout_versions) != set(by_id):
                raise HTTPException(409, 'The position list changed. Reload and review the draft layout.')
            for key, version in versions.items():
                if layout_versions.get(key) != version:
                    raise HTTPException(409, 'Position draft and layout refer to different saved revisions.')
            versions = layout_versions
        for image in retained:
            if image.position_key > 0:
                previous = versions.setdefault(image.position_key, image.expected_position_updated_at)
                if previous != image.expected_position_updated_at:
                    raise HTTPException(409, 'An image was attached against a different position revision. Review its association.')
        for key, version in versions.items():
            if key not in by_id:
                raise HTTPException(409, 'A drafted position was deleted. Review your draft.')
            claim_position_version(db, by_id[key], version)
            db.expire(by_id[key], ['images'])
        if layout is not None and {r[0] for r in db.query(Position.id).filter_by(visit_id=visit_id)} != set(by_id):
            raise HTTPException(409, 'The position list changed. Reload and review the draft layout.')
        header = VisitUpdate.model_validate(data.get('headerDraft') or {}).model_dump(exclude_unset=True)
        if header:
            expected = timestamp(data['headerBefore']['updated_at'])
            changed = db.execute(update(Visit).where(Visit.id == visit_id, Visit.updated_at == expected)
                .values(updated_at=dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)).execution_options(synchronize_session=False))
            if changed.rowcount != 1:
                raise HTTPException(409, 'Visit details changed since this draft began. Reload and compare before saving.')
            if user.role == 'team_member':
                header.pop('team_id', None); header.pop('assigned_member_id', None)
            if 'assigned_member_id' in header:
                _validate_assigned_member(db, header.get('team_id', visit.team_id), header['assigned_member_id'])
            for field, value in header.items():
                setattr(visit, field, value)
        for key, item in changes.items():
            key = int(key)
            if key > 0:
                payload = PositionUpdate.model_validate(item['changes']).model_copy(update={'expected_updated_at': None})
                apply_position_update(db, by_id[key], payload)
                if not item['before'].get('direction'):
                    by_id[key].prepared_only = True
        for item in additions:
            key = int(item['id'])
            if key >= 0 or key in by_id:
                raise HTTPException(422, 'New position identifiers must be unique draft identifiers')
            values = {**item, **changes.get(str(key), {}).get('changes', {})}
            config = PositionCreate.model_validate(values)
            if db.query(Position.id).filter_by(visit_id=visit_id, ohl=config.ohl, phase=config.phase, string=config.string, direction=config.direction, view_side=config.view_side).first():
                raise HTTPException(409, 'This position already exists. Reload and compare before confirming.')
            position = Position(visit=visit, **config.model_dump(), prepared_only=True, in_scope=True)
            db.add(position); db.flush()
            position.images = [Image(image_type=kind, evidence_status='NOT REQUIRED') for kind in IMAGE_TYPE_CHOICES]
            db.flush()
            apply_position_update(db, position, PositionUpdate.model_validate(values).model_copy(update={'expected_updated_at': None}))
            by_id[key] = position
        if layout is not None:
            if not layout or len(layout) != len(set(layout)) or any(key not in by_id for key in layout):
                raise HTTPException(422, 'The layout contains missing or duplicate positions')
            for key, position in by_id.items():
                if key not in layout:
                    if has_observations(position) or (position.direction and not position.prepared_only):
                        raise HTTPException(409, 'The layout cannot omit positions with recorded work.')
                    position.in_scope = False
                else:
                    position.in_scope = True
            if data.get('saveTemplate'):
                if user.role == 'team_member':
                    raise HTTPException(403, 'Only a team leader can save the tower template')
                visit.tower.inspection_layout = [PositionCreate.model_validate(by_id[key], from_attributes=True).model_dump() for key in layout]
        for image in retained:
            position = by_id.get(image.position_key)
            if not position or not position.in_scope or not position.direction:
                raise HTTPException(422, 'Every draft image needs a configured position included in this visit.')
            if image.image_type == 'Voice note':
                relative = f'{position.id}/draft-{image.token}{file_extension(image.filename, image.content_type)}'
                raw = (settings.images_dir / image.file_path).read_bytes()
                save_upload(raw, relative, base_dir=settings.voice_notes_dir)
                position.voice_note_path = relative
                position.voice_note_content_type = image.content_type
                position.voice_note_original_filename = image.filename
                position.voice_note_duration_seconds = image.duration_seconds
                position.voice_note_transcript = None
                continue
            refresh_position_codes(position)
            target = next((i for i in position.images if i.image_type == image.image_type and i.sequence == 1 and not i.file_path), None)
            if target is None:
                sequence = max((i.sequence for i in position.images if i.image_type == image.image_type), default=0) + 1
                target = Image(position=position, image_type=image.image_type, sequence=sequence,
                    image_code=f'{position_image_code(position, image.image_type)}-{sequence}')
                db.add(target); db.flush()
            target.upload_token = image.token
            raw = (settings.images_dir / image.file_path).read_bytes()
            await apply_upload(target, raw, image.filename, image.content_type, None, None, None, None, new_revision=True)
        for image in staged:
            image.consumed = True
        draft.payload = {}
        draft.last_commit_token = str(body.token)
        db.commit()
    except (ValidationError, KeyError, TypeError, ValueError) as err:
        db.rollback()
        raise HTTPException(422, f'Review the draft fields: {err}')
    except Exception:
        db.rollback()
        raise
    db.expire_all()
    return attach_rollup(_load_visit(db, visit_id), detail=True)
