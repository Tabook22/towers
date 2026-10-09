from __future__ import annotations

import json
import shutil
import sqlite3
import time
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Literal

from app.config import settings
from app.deps import get_current_user
from app.models import User
from app.services import backup_jobs as jobs, backups as service

router = APIRouter(prefix='/api/backups', tags=['backup-recovery'])


def full_admin(user: User = Depends(get_current_user)):
    if user.role != 'admin' or not user.is_super_admin:
        raise HTTPException(403, 'Only a full administrator can back up or restore application data.')
    return user


def job(ident):
    try:
        return jobs.get(ident)
    except (ValueError, TypeError):
        raise HTTPException(404, 'Backup job not found or expired.')


def public(data):
    result = dict(data)
    # Large per-file checksums remain in the ZIP; the UI needs counts and the visit index only.
    if result.get('summary'):
        s = result['summary']
        result['summary'] = {k:v for k,v in s.items() if k not in ('files','members')}
        result['summary']['file_count'] = s.get('file_count', len(s.get('files', [])))
    return result


@router.get('')
def list_jobs(user: User = Depends(full_admin)):
    return [public(j) for j in jobs.list_jobs()]


class ScheduleSettings(BaseModel):
    enabled: bool = False
    interval_hours: int = Field(default=24, ge=1, le=720)
    retention_days: int = Field(default=7, ge=1, le=365)
    retention_count: int = Field(default=7, ge=1, le=100)


@router.get('/overview')
def overview(user: User = Depends(full_admin)):
    return jobs.overview()


@router.put('/schedule')
def configure_schedule(body: ScheduleSettings, user: User = Depends(full_admin)):
    return jobs.configure_schedule(body.model_dump(), user.username)


@router.post('', status_code=202)
def create_backup(user: User = Depends(full_admin)):
    data = jobs.create('backup', user.username)
    jobs.submit(data['id'], jobs.backup)
    return public(data)


class UploadStart(BaseModel):
    size: int = Field(gt=0)


@router.post('/uploads', status_code=201)
def start_upload(body: UploadStart, user: User = Depends(full_admin)):
    if body.size > settings.backup_max_archive_gb * 1024**3:
        raise HTTPException(413, 'Backup exceeds the configured archive size limit.')
    if shutil.disk_usage(settings.backups_dir).free < body.size * 2 + 128 * 1024**2:
        raise HTTPException(507, 'Insufficient disk space to upload and validate this backup.')
    return public(jobs.create('upload', user.username, expected_size=body.size))


@router.put('/{ident}/upload')
async def upload_chunk(ident: str, request: Request, offset: int, user: User = Depends(full_admin)):
    data = job(ident)
    if data['kind'] != 'upload' or data['status'] != 'uploading':
        raise HTTPException(409, 'This upload is closed.')
    # Bound memory independently of the request's claimed Content-Length.
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > 8 * 1024**2:
            raise HTTPException(413, 'Upload chunks must be at most 8 MiB.')
    with jobs.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        current = json.loads(conn.execute('SELECT data FROM jobs WHERE id=?', (ident,)).fetchone()[0])
        path = jobs.directory(ident) / 'upload.zip'
        actual = path.stat().st_size if path.exists() else 0
        if current['status'] != 'uploading' or offset != actual or offset + len(chunks) > current['expected_size']:
            raise HTTPException(409, 'Upload offset changed. Resume from the reported size.')
        with path.open('ab') as out:
            out.write(chunks)
        current.update(size=actual + len(chunks), updated=time.time())
        conn.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(current), ident))
    return public(current)


@router.post('/{ident}/validate', status_code=202)
def validate_backup(ident: str, user: User = Depends(full_admin)):
    data = job(ident)
    path = jobs.directory(ident) / 'upload.zip'
    if data['kind'] != 'upload' or not path.is_file() or path.stat().st_size != data.get('expected_size'):
        raise HTTPException(409, 'Upload every chunk before validation.')
    try:
        jobs.claim(ident, ['uploading', 'validated', 'failed', 'interrupted'])
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    jobs.submit(ident, jobs.validate)
    return public(jobs.get(ident))


class RestoreRequest(BaseModel):
    mode: Literal['full']
    visit_ids: list[int] = Field(default_factory=list, max_length=10000)
    confirmation: str = ''


@router.post('/{ident}/preview')
def preview_restore(ident: str, body: RestoreRequest, user: User = Depends(full_admin)):
    if job(ident)['status'] != 'validated':
        raise HTTPException(409, 'Validate this backup first.')
    try:
        with service.connect(jobs.directory(ident) / 'validated' / 'database.sqlite3') as src, service.connect(service.live_path()) as dst:
            _, plan = service.restore_plan(src, dst, body.mode, body.visit_ids)
        jobs.patch(ident, previewed_by=user.username)
        jobs.audit(user.username, 'preview_restore', ident)
        return plan
    except (ValueError, sqlite3.IntegrityError) as exc:
        raise HTTPException(409, str(exc))


@router.post('/{ident}/restore', status_code=202)
def restore_backup(ident: str, body: RestoreRequest, user: User = Depends(full_admin)):
    if job(ident)['status'] != 'validated' or body.confirmation != 'RESTORE' or job(ident).get('previewed_by') != user.username:
        raise HTTPException(409, 'Validate, preview and type RESTORE to confirm.')
    preview_restore(ident, body, user)
    data = jobs.create('restore', user.username, source_id=ident, mode=body.mode, visit_ids=body.visit_ids)
    jobs.submit(data['id'], jobs.recover, ident, body.mode, body.visit_ids)
    return public(data)


@router.get('/{ident}')
def status(ident: str, user: User = Depends(full_admin)):
    data = job(ident)
    if data['status'] == 'uploading':
        path = jobs.directory(ident) / 'upload.zip'
        data['size'] = path.stat().st_size if path.exists() else 0
    return public(data)


@router.get('/{ident}/download')
def download(ident: str, user: User = Depends(full_admin)):
    data = job(ident)
    if data['status'] != 'complete' or data['kind'] not in ('backup','recovery'):
        raise HTTPException(409, 'Backup is not ready.')
    jobs.audit(user.username, 'download', ident)
    return FileResponse(jobs.directory(ident) / 'backup.zip', media_type='application/zip',
                        filename=data['filename'], headers={'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff'})


@router.delete('/{ident}', status_code=204)
def delete_job(ident: str, user: User = Depends(full_admin)):
    data = job(ident)
    if data['status'] in ('queued','running'):
        raise HTTPException(409, 'An active job cannot be removed.')
    # Do not remove a validated source while another worker is using it.
    if any(j.get('source_id') == ident and j['status'] in ('queued','running') for j in jobs.list_jobs()):
        raise HTTPException(409, 'This backup is in use by a restore.')
    path = jobs.directory(ident).resolve()
    if path.parent != settings.backups_dir.resolve():
        raise HTTPException(400, 'Invalid job path.')
    shutil.rmtree(path)
    with jobs.connection() as c:
        c.execute('DELETE FROM jobs WHERE id=?', (ident,))
