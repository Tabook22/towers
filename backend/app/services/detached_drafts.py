"""Explicit offline recovery of drafts whose visits no longer exist.

Never called at application startup. Stop inspection writes and take a fresh raw
recovery backup before use. Archives are private recovery material, not portable
application imports; keep them alongside the raw backup, including an off-server copy.
Original visit IDs, payloads, child rows and file bytes are retained without guessing
ownership. Evidence files in the source storage are never deleted by this tool.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3


def digest(path):
    checksum = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(part)
    return checksum.hexdigest()


def detached_records(conn):
    drafts = [dict(row) for row in conn.execute('SELECT d.* FROM visit_entry_drafts d LEFT JOIN visits v ON v.id=d.visit_id WHERE v.id IS NULL ORDER BY d.id')]
    images = [dict(row) for row in conn.execute('SELECT i.* FROM visit_draft_images i JOIN visit_entry_drafts d ON d.id=i.draft_id LEFT JOIN visits v ON v.id=d.visit_id WHERE v.id IS NULL ORDER BY i.id')]
    return {'visit_entry_drafts': drafts, 'visit_draft_images': images}


def archive_detached_drafts(database, images_root, archive, *, apply=False, writes_stopped=False):
    database, images_root, archive = map(lambda p: Path(p).resolve(), (database, images_root, archive))
    if not database.is_file() or not images_root.is_dir():
        raise ValueError('An existing database and image root must be supplied explicitly')
    if apply and not writes_stopped:
        raise ValueError('Stop inspection writes and acknowledge writes_stopped before applying')
    if archive.is_relative_to(images_root) or database.is_relative_to(archive):
        raise ValueError('Recovery archive must be separate from the database and image storage')
    with sqlite3.connect(database.as_uri() + '?mode=rw', uri=True) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA trusted_schema=OFF')
        conn.execute('BEGIN IMMEDIATE' if apply else 'BEGIN')
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Source database integrity check failed')
        records = detached_records(conn)
        counts = {name: len(rows) for name, rows in records.items()}
        if not apply or not counts['visit_entry_drafts']:
            return {'applied': False, 'counts': counts}
        # Exclusive directory creation prevents overwriting a previous recovery archive.
        archive.mkdir(mode=0o700, parents=True, exist_ok=False)
        if os.name != 'nt':
            archive.chmod(0o700)
        files = []
        for row in records['visit_draft_images']:
            relative = row['file_path']
            if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative or '\x00' in relative or any(p in ('', '.', '..') for p in relative.split('/')):
                raise ValueError('Unsafe draft attachment path; no records removed')
            source = (images_root / relative).resolve()
            if not source.is_relative_to(images_root) or not source.is_file():
                raise ValueError('Missing or unsafe draft attachment; no records removed')
            target = archive / 'files' / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(source, target)
            if os.name != 'nt':
                target.chmod(0o600)
            checksum = digest(source)
            if digest(target) != checksum:
                raise ValueError('Attachment copy verification failed; no records removed')
            with target.open('r+b') as stream:
                os.fsync(stream.fileno())
            files.append({'draft_image_id': row['id'], 'relative_path': relative, 'sha256': checksum, 'size': target.stat().st_size})
        manifest = {'format_version': 1, 'purpose': 'detached-inspection-draft-recovery',
                    'counts': counts, 'records': records, 'files': files}
        path = archive / 'records.json'
        with path.open('x', encoding='utf8') as stream:
            if os.name != 'nt':
                os.fchmod(stream.fileno(), 0o600)
            json.dump(manifest, stream, ensure_ascii=False, indent=2)
            stream.flush(); os.fsync(stream.fileno())
        if json.loads(path.read_text(encoding='utf8')) != manifest:
            raise ValueError('Recovery records failed verification; no records removed')
        # Flush every newly created directory before committing removal of active rows.
        if os.name != 'nt':
            directories = sorted((p for p in archive.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True)
            for directory in [*directories, archive, archive.parent]:
                descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
        if detached_records(conn) != records:
            raise ValueError('Draft records changed during recovery; no records removed')
        for row in records['visit_draft_images']:
            conn.execute('DELETE FROM visit_draft_images WHERE id=?', (row['id'],))
        for row in records['visit_entry_drafts']:
            conn.execute('DELETE FROM visit_entry_drafts WHERE id=?', (row['id'],))
        if detached_records(conn)['visit_entry_drafts']:
            raise ValueError('Detached draft cleanup did not complete; transaction rolled back')
        conn.commit()
        return {'applied': True, 'counts': counts, 'archive_sha256': digest(path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--images-root', required=True, type=Path)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--writes-stopped', action='store_true')
    args = parser.parse_args()
    print(json.dumps(archive_detached_drafts(args.database, args.images_root, args.archive,
        apply=args.apply, writes_stopped=args.writes_stopped)))


if __name__ == '__main__':
    main()
