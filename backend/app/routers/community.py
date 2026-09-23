"""Shared internal conversation, including staff without a team assignment."""
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.deps import get_current_user
from app.models import TeamChannelMessage, User
from app.routers import channel
from app.services.archive import build_thumbnail, file_extension, save_upload
from app.services.channel import message_out

router = APIRouter(prefix='/api/community/channel', tags=['channel'])

def internal_user(user: User = Depends(get_current_user)):
    if user.role not in ('admin', 'reviewer', 'team_leader', 'team_member'):
        raise HTTPException(403, 'This conversation is for internal staff')
    return user

@router.get('')
def history(before_id: int | None = None, team_id: int | None = None, include_ops: bool = False,
            search: str = '', db: Session = Depends(get_db), user: User = Depends(internal_user)):
    q = db.query(TeamChannelMessage).options(joinedload(TeamChannelMessage.author), joinedload(TeamChannelMessage.team), joinedload(TeamChannelMessage.tower))
    if before_id is not None:
        q = q.filter(TeamChannelMessage.id < before_id)
    if team_id is not None:
        q = q.filter(TeamChannelMessage.team_id == team_id)
    if not include_ops:
        q = q.filter(TeamChannelMessage.kind.notin_(['assign', 'unassign']))
    if search.strip():
        q = q.filter(TeamChannelMessage.body.contains(search.strip(), autoescape=True))
    rows = q.order_by(TeamChannelMessage.id.desc()).limit(61).all()
    has_more = len(rows) > 60
    rows = rows[:60]
    return {'messages': [message_out(r) for r in reversed(rows)], 'has_more': has_more,
            'before_id': rows[-1].id if rows else None}

@router.post('', status_code=201)
async def post(background_tasks: BackgroundTasks, body: str = Form(''),
               attachment_type: str | None = Form(None), file: UploadFile | None = File(None),
               duration_seconds: float | None = Form(None), latitude: float | None = Form(None),
               longitude: float | None = Form(None), db: Session = Depends(get_db), user: User = Depends(internal_user)):
    if len(body) > 10000:
        raise HTTPException(400, 'Messages can contain up to 10,000 characters')
    if (latitude is None) != (longitude is None) or (latitude is not None and not (-90 <= latitude <= 90 and -180 <= longitude <= 180)):
        raise HTTPException(400, 'Invalid location')
    if duration_seconds is not None and not 0 <= duration_seconds <= 3600:
        raise HTTPException(400, 'Invalid recording duration')
    raw, ctype = b'', ''
    if file:
        raw = await file.read(channel.settings.max_upload_size_mb * 1024 * 1024 + 1)
        if not raw or len(raw) > channel.settings.max_upload_size_mb * 1024 * 1024:
            raise HTTPException(400, f'Choose a non-empty file up to {channel.settings.max_upload_size_mb} MB')
        ctype = (file.content_type or '').split(';')[0].lower().strip()
        allowed = {'photo': channel.ACCEPTED_PHOTO, 'video': channel.ACCEPTED_VIDEO,
                   'voice': {'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'}, 'file': channel.ACCEPTED_FILE}
        if ctype not in allowed.get(attachment_type, set()):
            raise HTTPException(400, 'This attachment format is not supported. Choose a photo, video, audio recording or document.')
    elif attachment_type:
        raise HTTPException(400, 'Choose an attachment first')
    row = channel._create_row(db, user.team_id, user, 'note', body, None, latitude, longitude,
                              allow_empty=bool(file), automatic_location=False)
    if file:
        rel = f'community/{row.field_date}/{uuid.uuid4().hex}{file_extension(file.filename, ctype)}'
        save_upload(raw, rel, base_dir=channel.settings.channel_dir)
        if attachment_type == 'photo':
            row.photo_path = rel
            row.photo_thumb_path = build_thumbnail(rel, source_base_dir=channel.settings.channel_dir, thumb_base_dir=channel.settings.channel_dir / 'thumbs')
            row.photo_content_type = ctype
            row.photo_original_filename = file.filename
        elif attachment_type == 'voice':
            row.audio_path, row.audio_content_type = rel, ctype
            row.duration_seconds = duration_seconds
        elif attachment_type == 'video':
            row.video_path, row.video_content_type = rel, ctype
            row.video_original_filename = file.filename
        else:
            row.file_path, row.file_content_type = rel, ctype
            row.file_original_filename, row.file_size = file.filename, len(raw)
        if not row.body:
            row.body = {'photo': 'Photo', 'video': 'Video', 'voice': 'Voice note', 'file': file.filename or 'Document'}[attachment_type]
    channel._schedule_push(background_tasks, db, user.team_id, user, row)
    db.commit()
    return message_out(channel._load_message(db, user.team_id, row.id))

@router.get('/{message_id}/{media_kind}')
def media(message_id: int, media_kind: str, thumb: bool = False, db: Session = Depends(get_db), user: User = Depends(internal_user)):
    row = db.get(TeamChannelMessage, message_id)
    if row is None:
        raise HTTPException(404, 'Message not found')
    if media_kind == 'photo':
        return channel.channel_photo(row.team_id, row.id, thumb=thumb, db=db, _user=user)
    handler = {'audio': channel.channel_audio, 'video': channel.channel_video, 'file': channel.channel_file}.get(media_kind)
    if handler is None:
        raise HTTPException(404, 'Attachment not found')
    return handler(row.team_id, row.id, db=db, _user=user)
