"""Private disk-backed report jobs; short polling requests avoid proxy timeouts."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import json
import logging
import shutil
import sqlite3
import threading
import time
import uuid

from fastapi import HTTPException
from app.config import settings
from app.database import SessionLocal
from app.models import User, UserRole, Tower
from app.deps import has_permission_level
from app.services import report_progress

pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='report-generation')
log = logging.getLogger(__name__)


def root():
    path = settings.backups_dir / 'report-jobs'
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def connect():
    conn = sqlite3.connect(root() / 'jobs.sqlite3', timeout=30)
    conn.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner INTEGER NOT NULL, token TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(owner,token))')
    return conn


def directory(ident):
    if str(uuid.UUID(ident)) != ident:
        raise HTTPException(404, 'Report job not found')
    return root() / ident


def authorize(db, user, kind, payload):
    from app.routers.reports import _resolve_tower_team
    if not user.is_active or user.role not in (UserRole.ADMIN.value, UserRole.REVIEWER.value, UserRole.TEAM_LEADER.value):
        raise HTTPException(403, 'Not enough permissions')
    if user.role == UserRole.ADMIN.value and not has_permission_level(user, 'generate_reports', 'add'):
        raise HTTPException(403, 'Not enough permissions')
    if payload.start_date > payload.end_date:
        raise HTTPException(422, 'Start date must be on or before end date')
    if kind != 'team' and user.role == UserRole.TEAM_LEADER.value:
        raise HTTPException(403, 'Not enough permissions')
    if kind == 'team' and user.role == UserRole.TEAM_LEADER.value:
        team = payload.team_id
        if team is None and payload.tower_id is not None:
            tower = db.get(Tower, payload.tower_id)
            team = _resolve_tower_team(db, tower, payload.start_date, payload.end_date) if tower else None
        if team is None or team != user.team_id:
            raise HTTPException(403, "You don't have access to this team")


def create(owner, token, kind, payload):
    raw = json.dumps({'kind': kind, 'payload': payload}, sort_keys=True)
    fingerprint = hashlib.sha256(raw.encode()).hexdigest()
    with closing(connect()) as conn, conn:
        conn.execute('BEGIN IMMEDIATE')
        cutoff = time.time() - settings.backup_retention_days * 86400
        for ident, stored in conn.execute('SELECT id,data FROM jobs').fetchall():
            expired = json.loads(stored)
            if expired['status'] not in ('queued', 'running') and expired['updated'] < cutoff:
                path = directory(ident).resolve()
                if path.parent != root().resolve():
                    raise ValueError('Unsafe report job cleanup path')
                shutil.rmtree(path, ignore_errors=True)
                conn.execute('DELETE FROM jobs WHERE id=?', (ident,))
        row = conn.execute('SELECT fingerprint,data FROM jobs WHERE owner=? AND token=?', (owner, token)).fetchone()
        if row:
            if row[0] != fingerprint:
                raise HTTPException(409, 'This request token belongs to a different report')
            return json.loads(row[1]), False
        # Avoid building several huge reports for the same account simultaneously.
        for (stored,) in conn.execute('SELECT data FROM jobs WHERE owner=?', (owner,)):
            job = json.loads(stored)
            if job['status'] in ('queued', 'running') and time.time() - job['updated'] < 180:
                raise HTTPException(409, 'A report is already being created. Follow its progress before starting another.')
        ident = str(uuid.uuid4())
        data = dict(id=ident, owner=owner, kind=kind, payload=payload, status='queued', stage='Waiting to start',
                    created_at=time.time(), started_at=None, finished_at=None, updated=time.time(),
                    completed=0, total=0, percent=0, findings_done=0, findings_total=0,
                    photos_done=0, photos_total=0, sections_done=0, sections_total=0)
        directory(ident).mkdir(mode=0o700)
        conn.execute('INSERT INTO jobs VALUES (?,?,?,?,?)', (ident, owner, token, fingerprint, json.dumps(data)))
    return data, True


def patch(ident, **changes):
    with closing(connect()) as conn, conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT data FROM jobs WHERE id=?', (ident,)).fetchone()
        data = json.loads(row[0])
        data.update(changes, updated=time.time())
        conn.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(data), ident))
    return data


def get(ident, owner=None):
    directory(ident)
    with closing(connect()) as conn:
        row = conn.execute('SELECT data FROM jobs WHERE id=?', (ident,)).fetchone()
    if not row:
        raise HTTPException(404, 'Report job not found')
    data = json.loads(row[0])
    if owner is not None and data['owner'] != owner:
        raise HTTPException(404, 'Report job not found')
    if data['status'] in ('queued', 'running') and time.time() - data['updated'] > 180:
        data = patch(ident, status='interrupted', stage='Interrupted', finished_at=time.time(),
                     error='Report generation was interrupted. Check the report library before starting another report.')
    return data


def public(data):
    now = data.get('finished_at') or time.time()
    return {**{k: v for k, v in data.items() if k not in ('owner', 'payload')},
            'elapsed_seconds': max(0, now - data['created_at'])}


def heartbeat(ident, stopped):
    while not stopped.wait(10):
        patch(ident)


def dispatch(ident):
    # Keep the receipt alive while waiting in the executor queue as well as while rendering.
    stopped = threading.Event()
    threading.Thread(target=heartbeat, args=(ident, stopped), daemon=True).start()
    try:
        future = pool.submit(run, ident, stopped)
        future.add_done_callback(lambda _: stopped.set())
    except Exception:
        stopped.set()
        patch(ident, status='interrupted', stage='Interrupted', finished_at=time.time(),
              error='Report worker could not start. Check the report library before retrying.')
        raise


def run(ident, stopped=None):
    from app.backup_gate import maintenance
    from app.routers import reports
    from app.schemas import LineInspectionReportRequest, OetcAreaReportRequest, OetcConsolidatedReportRequest
    if stopped is None:
        stopped = threading.Event()
        threading.Thread(target=heartbeat, args=(ident, stopped), daemon=True).start()
    try:
        # Serialize expensive rendering across API workers without locking application data.
        with closing(sqlite3.connect(root() / 'worker.sqlite3', timeout=1)) as lock:
            lock.execute('CREATE TABLE IF NOT EXISTS worker (id INTEGER)')
            while True:
                try:
                    lock.execute('BEGIN EXCLUSIVE')
                    break
                except sqlite3.OperationalError as exc:
                    if 'locked' not in str(exc):
                        raise
                    time.sleep(1)
            job = get(ident)
            patch(ident, status='running', started_at=time.time(), stage='Loading inspections')
            kinds = {'team': (LineInspectionReportRequest, reports.oetc_line_report),
                     'area': (OetcAreaReportRequest, reports.oetc_area_report),
                     'consolidated': (OetcConsolidatedReportRequest, reports.oetc_consolidated_report)}
            model, render = kinds[job['kind']]
            payload = model.model_validate(job['payload'])
            progress = report_progress.Progress(lambda **values: patch(ident, **values))
            with maintenance(exclusive=False, timeout=60), SessionLocal() as db, report_progress.tracking(progress):
                user = db.get(User, job['owner'])
                if user is None:
                    raise HTTPException(403, 'Account is no longer available')
                authorize(db, user, job['kind'], payload)
                response = render(payload, db=db, user=user)
            progress.stage('Preparing download')
            path = directory(ident) / 'report.docx'
            with path.open('xb') as stream:
                stream.write(response.body)
                stream.flush()
                import os
                os.fsync(stream.fileno())
            filename = response.headers['content-disposition'].split('filename="', 1)[1].rstrip('"')
            patch(ident, status='complete', stage='Report ready', percent=100, completed=progress.data['total'],
                  filename=filename, size=path.stat().st_size, finished_at=time.time())
    except Exception as exc:
        log.exception('Report job %s failed', ident)
        patch(ident, status='failed', stage='Failed', finished_at=time.time(),
              error=str(exc.detail) if isinstance(exc, HTTPException) else 'Could not create the report. Check the report library before retrying.')
    finally:
        stopped.set()
