"""Cross-worker maintenance barrier, using SQLite OS locks on both Windows and Linux.

Ordinary requests hold a shared lock through streaming/background work. Snapshot/restore
holds an exclusive lock; new requests receive 503 instead of entering an inconsistent view.
This is separate from the application database and never exported.
"""
from contextlib import contextmanager
import sqlite3

from starlette.responses import JSONResponse
from app.config import settings


def gate_path():
    settings.backups_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    return settings.backups_dir / 'maintenance.sqlite3'


def initialize_gate():
    conn = sqlite3.connect(gate_path(), timeout=60)
    try:
        conn.execute('CREATE TABLE IF NOT EXISTS barrier (id INTEGER PRIMARY KEY)')
        conn.execute('INSERT OR IGNORE INTO barrier VALUES (1)')
        conn.commit()
    finally:
        conn.close()


@contextmanager
def maintenance(exclusive=False, timeout=0):
    conn = sqlite3.connect(gate_path(), timeout=timeout, check_same_thread=False)
    try:
        conn.execute('BEGIN EXCLUSIVE' if exclusive else 'BEGIN')
        conn.execute('SELECT id FROM barrier').fetchone()
        yield
    finally:
        conn.rollback()
        conn.close()


class BackupMaintenanceMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] != 'http' or path.startswith('/api/backups') or path == '/api/health' or scope.get('method') == 'OPTIONS':
            return await self.app(scope, receive, send)
        lock = maintenance()
        try:
            lock.__enter__()
        except sqlite3.OperationalError:
            return await JSONResponse({'detail': 'Backup or recovery in progress. Please retry shortly.'},
                status_code=503, headers={'Retry-After': '10'})(scope, receive, send)
        try:
            await self.app(scope, receive, send)
        finally:
            lock.__exit__(None, None, None)
