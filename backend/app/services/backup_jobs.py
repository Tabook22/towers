"""Disk-backed jobs shared by all API workers; heavy work runs outside HTTP requests."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import logging
from pathlib import Path
import shutil
import sqlite3
import threading
import time
import uuid
import zipfile

from app.config import settings
from app.backup_gate import maintenance
from app.services import backups as service

log = logging.getLogger(__name__)
pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='inspection-backup')


def connection():
    settings.backups_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    c = sqlite3.connect(settings.backups_dir / 'jobs.sqlite3', timeout=30, factory=service.ClosingConnection)
    c.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    c.execute('CREATE TABLE IF NOT EXISTS backup_metadata (key TEXT PRIMARY KEY, data TEXT NOT NULL)')
    c.execute('CREATE TABLE IF NOT EXISTS backup_audit (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, job_id TEXT, status TEXT NOT NULL)')
    return c


def directory(ident):
    if str(uuid.UUID(ident)) != ident:
        raise ValueError('Invalid backup job identifier.')
    return settings.backups_dir / ident


def create(kind, owner, **extra):
    cleanup()
    ident = str(uuid.uuid4())
    directory(ident).mkdir(parents=True, mode=0o700)
    data = {'id': ident, 'kind': kind, 'owner': owner, 'created_at': service.utcnow(),
            'updated': time.time(), 'status': 'uploading' if kind == 'upload' else 'queued',
            'stage': 'Waiting', 'processed_files': 0, 'size': 0, **extra}
    with connection() as c:
        c.execute('INSERT INTO jobs VALUES (?,?)', (ident, json.dumps(data)))
    audit(owner, 'create_' + kind, ident, data['status'])
    return data


def get(ident):
    directory(ident)
    with connection() as c:
        row = c.execute('SELECT data FROM jobs WHERE id=?', (ident,)).fetchone()
    if not row:
        raise ValueError('Backup job not found or expired.')
    data = json.loads(row[0])
    parent = get(data['parent_id']) if data.get('parent_id') and data['status'] == 'queued' else None
    if data['status'] in ('running','queued') and data['updated'] < time.time() - 180 and not (parent and parent['status'] == 'running'):
        patch(ident, status='interrupted', error='Worker interrupted. Inspect the current dataset before retrying a restore; upload and validate again.')
        return get(ident)
    return data


def patch(ident, **changes):
    if 'summary' in changes:
        manifest = changes['summary']
        changes['summary'] = {k: v for k, v in manifest.items() if k not in ('files', 'members')}
        changes['summary']['file_count'] = len(manifest['files'])
    with connection() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT data FROM jobs WHERE id=?', (ident,)).fetchone()
        if not row:
            raise ValueError('Job expired.')
        data = json.loads(row[0]); data.update(changes, updated=time.time())
        c.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(data), ident))
        if changes.get('status') == 'complete' and data['kind'] == 'backup':
            c.execute('INSERT OR REPLACE INTO backup_metadata VALUES (?,?)', ('last_success', json.dumps({k:data[k] for k in ('id','created_at','updated','status','size','filename')})))
    if changes.get('status') in ('complete','failed','interrupted','validated'):
        audit(data['owner'], data['kind'], ident, changes['status'])


def list_jobs():
    with connection() as c:
        ids = [r[0] for r in c.execute('SELECT id FROM jobs ORDER BY rowid DESC LIMIT 500')]
    return [get(i) for i in ids]


def claim(ident, allowed):
    with connection() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT data FROM jobs WHERE id=?', (ident,)).fetchone()
        data = json.loads(row[0]) if row else {}
        if data.get('status') not in allowed:
            raise ValueError('This job is not ready or is already running.')
        data.update(status='queued', updated=time.time())
        c.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(data), ident))


def cleanup():
    cutoff = time.time() - settings.backup_retention_days * 86400
    with connection() as c:
        rows = c.execute('SELECT id,data FROM jobs').fetchall()
        in_use = {j.get('source_id') for _, raw in rows if (j := json.loads(raw))['status'] in ('queued','running')}
        for ident, raw in rows:
            job = json.loads(raw)
            job_cutoff = time.time() - schedule_settings()['retention_days'] * 86400 if job.get('automatic') else cutoff
            if ident not in in_use and job['updated'] < job_cutoff and job['status'] not in ('running','queued'):
                path = directory(ident).resolve()
                if path.parent != settings.backups_dir.resolve():
                    raise ValueError('Unsafe cleanup path.')
                shutil.rmtree(path, ignore_errors=True)
                c.execute('DELETE FROM jobs WHERE id=?', (ident,))


def authorize_operator(username):
    with service.connect(service.live_path()) as c:
        if not c.execute("SELECT 1 FROM users WHERE username=? AND role='admin' AND is_super_admin=1 AND is_active=1", (username,)).fetchone():
            raise ValueError('Full administrator authorization is required.')


def run(ident, operation):
    stop = threading.Event()
    def heartbeat():
        while not stop.wait(10):
            patch(ident)
    threading.Thread(target=heartbeat, daemon=True).start()
    try:
        patch(ident, status='running', stage='Starting')
        # One heavy operation across every worker. Does not block ordinary application requests.
        with sqlite3.connect(settings.backups_dir / 'operation.sqlite3', timeout=1, factory=service.ClosingConnection) as lock:
            lock.execute('CREATE TABLE IF NOT EXISTS lock (id INTEGER)')
            lock.execute('BEGIN EXCLUSIVE')
            operation()
            lock.rollback()
    except Exception as exc:
        log.exception('Backup job %s failed', ident)
        message = str(exc) if isinstance(exc, ValueError) else 'Operation failed. Check server logs and available disk space, then retry.'
        if isinstance(exc, zipfile.BadZipFile):
            message = 'Invalid or damaged ZIP archive.'
        patch(ident, status='failed', stage='Failed', error=message)
    finally:
        stop.set()
        # Working copies can contain a transient raw database before sanitization; never retain.
        for name in ('snapshot', 'recheck'):
            shutil.rmtree(directory(ident) / name, ignore_errors=True)
        if get(ident)['status'] == 'failed':
            (directory(ident) / 'backup.zip').unlink(missing_ok=True)
            if get(ident)['kind'] == 'upload':
                shutil.rmtree(directory(ident) / 'validated', ignore_errors=True)


def progress(ident):
    last = [0.0]
    def update(stage, n):
        if time.monotonic() - last[0] > 0.5:
            patch(ident, stage=stage, processed_files=n)
            last[0] = time.monotonic()
    return update


def backup(ident):
    job = get(ident)
    path = directory(ident)
    with maintenance(exclusive=True, timeout=60):
        authorize_operator(job['owner'])
        patch(ident, stage='Consistent snapshot — application temporarily paused')
        manifest = service.snapshot(path / 'snapshot', progress(ident))
    service.pack(path / 'snapshot', path / 'backup.zip', progress(ident))
    patch(ident, status='complete', stage='Backup ready', size=(path / 'backup.zip').stat().st_size,
          filename='inspection-backup-' + time.strftime('%Y-%m-%d-%H%M%S', time.gmtime()) + '.zip',
          summary=manifest)
    if job.get('automatic'):
        prune_scheduled(schedule_settings())


def validate(ident):
    path = directory(ident)
    shutil.rmtree(path / 'validated', ignore_errors=True)
    manifest = service.validate_archive(path / 'upload.zip', path / 'validated', progress(ident))
    patch(ident, status='validated', stage='Backup validated — ready for preview', summary=manifest)


def recover(ident, source_id, mode, visits):
    path = directory(ident)
    source = directory(source_id)
    job = get(ident)
    # Recheck immutable uploaded ZIP at the time of restore, not just its earlier preview.
    service.validate_archive(source / 'upload.zip', path / 'recheck', progress(ident))
    with maintenance(exclusive=True, timeout=60):
        authorize_operator(job['owner'])
        with service.connect(path / 'recheck' / 'database.sqlite3') as src, service.connect(service.live_path()) as dst:
            service.restore_plan(src, dst, mode, visits)  # Fresh conflict check before backup or writes.
        patch(ident, stage='Creating mandatory recovery backup — application paused')
        recovery = create('recovery', job['owner'], parent_id=ident)
        recovery_path = directory(recovery['id'])
        patch(ident, recovery_id=recovery['id'])
        try:
            manifest = service.snapshot(recovery_path / 'snapshot', progress(ident))
            service.pack(recovery_path / 'snapshot', recovery_path / 'backup.zip', progress(ident))
            patch(recovery['id'], status='complete', stage='Pre-restore recovery backup', summary=manifest,
                  size=(recovery_path / 'backup.zip').stat().st_size, filename='SkyGreenLine_PreRestore_' + time.strftime('%Y-%m-%d_%H%M', time.gmtime()) + '.zip')
        except Exception:
            patch(recovery['id'], status='failed', error='Recovery backup failed; restore was not started.')
            raise
        finally:
            shutil.rmtree(recovery_path / 'snapshot', ignore_errors=True)
        patch(ident, stage='Restoring validated data — application paused')
        result = service.restore(path / 'recheck', mode, visits, job['owner'], progress(ident))
    patch(ident, status='complete', stage='Restore complete', result=result)


def submit(ident, function, *args):
    pool.submit(run, ident, lambda: function(ident, *args))


DEFAULT_SCHEDULE = {'enabled': False, 'interval_hours': 24, 'retention_days': 7, 'retention_count': 7, 'owner': None, 'next_run': None}

def audit(actor, action, job_id=None, status='complete'):
    with connection() as c:
        c.execute('INSERT INTO backup_audit (created_at,actor,action,job_id,status) VALUES (?,?,?,?,?)',
                  (service.utcnow(), actor, action, job_id, status))

def schedule_settings():
    with connection() as c:
        row = c.execute("SELECT data FROM backup_metadata WHERE key='schedule'").fetchone()
    return {**DEFAULT_SCHEDULE, **(json.loads(row[0]) if row else {})}

def configure_schedule(values, owner):
    data = {**schedule_settings(), **values, 'owner': owner, 'next_run': time.time() + values['interval_hours'] * 3600}
    with connection() as c:
        c.execute('INSERT OR REPLACE INTO backup_metadata VALUES (?,?)', ('schedule', json.dumps(data)))
    audit(owner, 'configure_schedule')
    return data

def overview():
    with connection() as c:
        row = c.execute("SELECT data FROM backup_metadata WHERE key='last_success'").fetchone()
        if row is None:
            for raw in c.execute('SELECT data FROM jobs ORDER BY rowid DESC'):
                previous = json.loads(raw[0])
                if previous['kind'] == 'backup' and previous['status'] == 'complete':
                    value = {k: previous[k] for k in ('id','created_at','updated','status','size','filename')}
                    c.execute('INSERT OR REPLACE INTO backup_metadata VALUES (?,?)', ('last_success', json.dumps(value)))
                    row = (json.dumps(value),)
                    break
        events = c.execute('SELECT created_at,actor,action,job_id,status FROM backup_audit ORDER BY id DESC LIMIT 30').fetchall()
    return {'last_success': json.loads(row[0]) if row else None, 'schedule': schedule_settings(),
            'audit': [dict(zip(('created_at','actor','action','job_id','status'), e)) for e in events]}

def scheduled_tick(now=None):
    now = time.time() if now is None else now
    list_jobs()  # Mark stale jobs interrupted after a worker restart.
    # Every API worker may tick; one transaction elects one runner for each interval.
    with connection() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute("SELECT data FROM backup_metadata WHERE key='schedule'").fetchone()
        if not row: return
        data = json.loads(row[0])
        if not data['enabled'] or data['next_run'] > now: return
        if any(json.loads(r[0])['status'] in ('running','queued') for r in c.execute('SELECT data FROM jobs')): return
        data['next_run'] = now + data['interval_hours'] * 3600
        c.execute('UPDATE backup_metadata SET data=? WHERE key=?', (json.dumps(data), 'schedule'))
    job = create('backup', data['owner'], automatic=True)
    submit(job['id'], backup)
    prune_scheduled(data)

def prune_scheduled(data):
    completed = sorted((j for j in list_jobs() if j.get('automatic') and j['status']=='complete'), key=lambda j:j['updated'], reverse=True)
    for index, job in enumerate(completed):
        if index >= data['retention_count'] or job['updated'] < time.time()-data['retention_days']*86400:
            with connection() as c:
                shutil.rmtree(directory(job['id']))
                c.execute('DELETE FROM jobs WHERE id=?', (job['id'],))
            audit('scheduler', 'retention_cleanup', job['id'])

def start_scheduler():
    stop = threading.Event()
    def loop():
        while not stop.wait(30):
            try: scheduled_tick()
            except Exception: log.exception('Automatic backup scheduler failed')
    thread = threading.Thread(target=loop, daemon=True, name='backup-scheduler')
    thread.start()
    return stop
