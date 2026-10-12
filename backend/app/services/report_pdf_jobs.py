"""Shared, disk-backed PDF jobs: short HTTP requests and one large conversion at a time."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import logging
import sqlite3
import threading
import time
from types import SimpleNamespace
from fastapi import HTTPException
from app.services.report_pdf import download_options, pdf_file, prepare_pdf

pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='report-pdf')
log = logging.getLogger(__name__)

def connect(target):
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target.parent / 'jobs.sqlite3', timeout=30)
    conn.execute('CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, status TEXT NOT NULL, error TEXT, updated REAL NOT NULL)')
    return conn

def status(record):
    options = download_options(record)
    if options['pdf_bytes'] is not None:
        return dict(options, status='complete', error=None)
    target = pdf_file(record)
    if target is None:
        return dict(options, status='unavailable', error='No archived Word document is available for PDF conversion')
    with closing(connect(target)) as conn, conn:
        conn.execute("UPDATE jobs SET status='failed', error='PDF conversion was interrupted. Please try again.' WHERE status IN ('queued','running') AND updated < ?", (time.time() - 120,))
        row = conn.execute('SELECT status,error FROM jobs WHERE key=?', (target.name,)).fetchone()
    return dict(options, status=row[0] if row else 'idle', error=row[1] if row else None)

def start(record):
    current = status(record)
    if current['status'] == 'complete':
        return current
    if not current['pdf_available']:
        raise HTTPException(503, current['error'] or 'PDF conversion is temporarily unavailable. Please try again later.')
    target = pdf_file(record)
    with closing(connect(target)) as conn, conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT status FROM jobs WHERE key=?', (target.name,)).fetchone()
        if row and row[0] in ('queued', 'running'):
            return dict(current, status=row[0], error=None)
        conn.execute("INSERT OR REPLACE INTO jobs VALUES (?, 'queued', NULL, ?)", (target.name, time.time()))
    snapshot = SimpleNamespace(id=record.id, file_path=record.file_path)
    # Start a heartbeat immediately, including time waiting in the executor's queue.
    stopped = threading.Event()
    threading.Thread(target=_heartbeat, args=(target, stopped), daemon=True).start()
    try:
        pool.submit(_run, snapshot, target, stopped)
    except Exception:
        stopped.set()
        _update(target, 'failed', 'Could not start PDF conversion. Please try again.')
        raise
    return dict(current, status='queued', error=None)

def _update(target, state, error=None):
    with closing(connect(target)) as conn, conn:
        conn.execute('UPDATE jobs SET status=?, error=?, updated=? WHERE key=?', (state, error, time.time(), target.name))

def _heartbeat(target, stopped):
    while not stopped.wait(10):
        try:
            with closing(connect(target)) as conn, conn:
                conn.execute("UPDATE jobs SET updated=? WHERE key=? AND status IN ('queued','running')", (time.time(), target.name))
        except Exception:
            log.exception('PDF job heartbeat failed')

def _run(record, target, stopped):
    try:
        while True:
            with closing(connect(target)) as conn, conn:
                conn.execute('BEGIN IMMEDIATE')
                conn.execute("UPDATE jobs SET status='failed', error='PDF conversion was interrupted. Please try again.' WHERE status IN ('queued','running') AND updated < ?", (time.time() - 120,))
                running = conn.execute("SELECT COUNT(*) FROM jobs WHERE status='running'").fetchone()[0]
                if running == 0:
                    conn.execute("UPDATE jobs SET status='running', updated=? WHERE key=?", (time.time(), target.name))
                    break
            time.sleep(2)
        prepare_pdf(record)
        if pdf_file(record) != target:
            raise RuntimeError('Archived report changed during conversion')
        _update(target, 'complete')
    except Exception:
        log.exception('PDF conversion failed for report %s', record.id)
        _update(target, 'failed', 'Could not create the PDF. Please try again or contact your inspection team.')
    finally:
        stopped.set()


def enqueue_reports(records):
    """Schedule committed archives; a PDF failure must never fail Word generation."""
    seen = set()
    for record in records:
        if record is None or record.id in seen:
            continue
        seen.add(record.id)
        try:
            start(record)
        except Exception:
            log.exception('Could not schedule automatic PDF for report %s; Word remains available', record.id)
