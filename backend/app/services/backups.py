"""Portable, secret-free SQLite recovery packages. No archive-supplied SQL is executed."""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from sqlalchemy.schema import CreateIndex, CreateTable

from app.config import settings
from app.database import Base, engine
from app import models  # registers metadata
from app.routers import live_help  # its four transient models also belong to the deployed schema

FORMAT_VERSION = 1
APP_VERSION = '1.0.0'
EXCLUDED_TABLES = {'push_subscriptions', 'thermal_edit_grants', 'live_help_presence', 'live_help_rooms', 'live_help_seats', 'live_help_signals', 'visit_creation_requests'}
EXCLUSIONS = [
    'Password hashes, login tokens, thermal editor grants and push subscriptions/keys.',
    'Environment files, server/SSH credentials, API keys, application code and server configuration.',
    'Browser-only/offline drafts not yet uploaded to the server; backups and temporary job files.',
    'Transient live-call presence, invitations, seats and WebRTC signalling (including session credentials).',
    'User profiles and permissions are included, but imported accounts are disabled until reset by an administrator.',
]
# Logical storage roots, independent of either instance's absolute paths.
def roots():
    result = {name: Path(getattr(settings, name + '_dir')).resolve() for name in (
        'images', 'thumbnails', 'reports', 'tower_photos', 'tower_photo_thumbnails',
        'report_templates', 'voice_notes', 'log_files', 'channel', 'branding', 'knowledge_base')}
    result['channel_thumbnails'] = result['channel'] / 'thumbs'
    return result


FILE_FIELDS = {
    'towers': {'photo_path': 'tower_photos', 'photo_thumbnail_path': 'tower_photo_thumbnails'},
    'positions': {'voice_note_path': 'voice_notes'},
    'images': {'file_path': 'images', 'thumbnail_path': 'thumbnails', 'annotated_path': 'images', 'annotated_thumbnail_path': 'thumbnails'},
    'visit_photos': {'file_path': 'images', 'thumbnail_path': 'thumbnails'},
    'visit_draft_images': {'file_path': 'images'},
    'report_templates': {'file_path': 'report_templates'},
    'line_inspection_reports': {'file_path': 'reports'},
    'team_daily_logs': {'audio_path': 'voice_notes'},
    'team_daily_log_files': {'file_path': 'log_files'},
    'team_channel_messages': {'photo_path': 'channel', 'photo_thumb_path': 'channel_thumbnails', 'audio_path': 'channel', 'video_path': 'channel', 'file_path': 'channel'},
    'team_archive_images': {'file_path': 'images', 'thumbnail_path': 'thumbnails'},
    'app_settings': {field: 'branding' for field in ('oetc_logo_filename', 'sky_green_line_logo_filename', 'hero_image_filename', 'org_logo_filename', 'login_background_filename')},
    'knowledge_documents': {'file_path': 'knowledge_base', 'voice_path': 'knowledge_base'},
}


def legacy_columns(*, before_view_side=False, before_report_snapshot=False, before_archive_relative_path=False):
    return {name: {column} for name, column, missing in (
        ('positions', 'view_side', before_view_side),
        ('line_inspection_reports', 'inspection_snapshot', before_report_snapshot),
        ('team_archive_images', 'relative_path', before_archive_relative_path),
    ) if missing}


def schema_signature(*, before_view_side=False, before_creation_requests=False,
                     before_report_snapshot=False, before_archive_relative_path=False):
    missing = legacy_columns(before_view_side=before_view_side, before_report_snapshot=before_report_snapshot,
                             before_archive_relative_path=before_archive_relative_path)
    schema = {name: [(c.name, str(c.type), c.nullable, c.primary_key,
                        sorted(f.target_fullname for f in c.foreign_keys)) for c in table.columns
                        if c.name not in missing.get(name, set())]
              for name, table in sorted(Base.metadata.tables.items())
              if not (before_creation_requests and name == 'visit_creation_requests')}
    return hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest()


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect(path):
    conn = sqlite3.connect(path, factory=ClosingConnection)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA trusted_schema=OFF')
    return conn


def live_path():
    if engine.dialect.name != 'sqlite' or not engine.url.database or engine.url.database == ':memory:':
        raise ValueError('Backup format 1 requires a file-backed SQLite database.')
    return Path(engine.url.database).resolve()


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def sync_directory(path):
    # POSIX requires a directory fsync as well as a file fsync for durable new names.
    if os.name != 'nt':
        handle = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(handle)
        finally:
            os.close(handle)


def safe_relative(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value or '\x00' in value:
        raise ValueError('Unsafe archive or attachment path.')
    p = PurePosixPath(value)
    if p.is_absolute() or any(x in ('', '.', '..') for x in value.split('/')):
        raise ValueError('Unsafe archive or attachment path.')
    return value


def resolve_file(base, rel):
    result = (base / safe_relative(rel)).resolve()
    if not result.is_relative_to(base.resolve()) or (base / rel).is_symlink():
        raise ValueError('Attachment path escapes its storage root.')
    return result


def check_database(conn, *, before_view_side=False, before_creation_requests=False,
                   before_report_snapshot=False, before_archive_relative_path=False):
    missing = legacy_columns(before_view_side=before_view_side, before_report_snapshot=before_report_snapshot,
                             before_archive_relative_path=before_archive_relative_path)
    if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('Database integrity check failed.')
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view') OR sql LIKE '%VIRTUAL TABLE%'").fetchone():
        raise ValueError('Database contains unsupported executable schema objects.')
    actual = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    expected = set(Base.metadata.tables) - ({'visit_creation_requests'} if before_creation_requests else set())
    if actual != expected:
        raise ValueError('Database tables are incompatible with this application version.')
    for name, table in Base.metadata.tables.items():
        if name not in expected:
            continue
        if {r['name'] for r in conn.execute(f'PRAGMA table_info("{name}")')} != (set(table.columns.keys()) - missing.get(name, set())):
            raise ValueError(f'Incompatible database columns: {name}.')
    # Validate using the trusted application relationships, not archive-supplied constraints.
    for name, table in Base.metadata.tables.items():
        if name in EXCLUDED_TABLES:
            continue
        for col in table.columns:
            for fk in col.foreign_keys:
                parent = fk.column.table.name
                sql = f'SELECT c."{col.name}" FROM "{name}" c LEFT JOIN "{parent}" p ON c."{col.name}"=p."{fk.column.name}" WHERE c."{col.name}" IS NOT NULL AND p."{fk.column.name}" IS NULL LIMIT 1'
                if conn.execute(sql).fetchone():
                    raise ValueError(f'Broken relationship: {name}.{col.name}.')


def file_references(conn):
    for table, fields in FILE_FIELDS.items():
        for row in conn.execute(f'SELECT * FROM "{table}"'):
            for field, root in fields.items():
                if row[field]:
                    yield table, row['id'], field, root, row[field]


def inline_references(conn):
    for row in conn.execute('SELECT id,body_html FROM knowledge_documents WHERE body_html IS NOT NULL'):
        for name in re.findall(r'/api/knowledge-base/inline-images/([^"/?<>\s]+)', row['body_html']):
            yield 'knowledge_documents', row['id'], 'body_html', 'knowledge_base', 'inline/' + name


def counts(conn, *, before_creation_requests=False):
    return {name: conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] for name in Base.metadata.tables
            if not (before_creation_requests and name == 'visit_creation_requests')}


def summary(conn):
    return [dict(r) for r in conn.execute('''SELECT v.id, v.inspection_date, v.mission_status,
        t.id AS tower_pk, t.tower_id, COALESCE(t.line_sector,t.area,'') AS line,
        (SELECT COUNT(*) FROM positions p WHERE p.visit_id=v.id) AS positions,
        (SELECT COUNT(*) FROM images i JOIN positions p ON i.position_id=p.id WHERE p.visit_id=v.id AND i.file_path IS NOT NULL) AS images
        FROM visits v JOIN towers t ON t.id=v.tower_id ORDER BY line,t.tower_id,v.inspection_date,v.id''')]


def slug(text):
    return re.sub(r'[^\w.-]+', '_', text or 'Unassigned', flags=re.UNICODE)[:70].strip('.') or 'Unassigned'


def instructions():
    return '''Sky Green Line portable inspection backup — format 1

database.sqlite3 is the authoritative, sanitized SQLite dataset. manifest.json maps its
attachment paths to files/ entries and records SHA-256 checksums. inspection-index.csv is
a readable index only. Do not edit the package. Checksums detect corruption, not authorship;
import only backups you trust. The ZIP contains confidential inspection data and is NOT encrypted.

Local or VPS recovery: install the same compatible application release, configure its own
database, storage directories and secrets, and sign in as a full administrator. Open Settings >
Backup & Restore, upload the ZIP in chunks, validate it, review the preview, select the restore
mode and confirm. The application creates a recovery ZIP before making changes.

Full recovery replaces all business records. Source profile IDs and relationships are preserved;
passwords are not imported. All source users are disabled. The destination operator's login is
retained (matched by username, otherwise added as a separate administrator). Reset passwords and
enable any other accounts deliberately. Server secrets and authentication tokens are never imported.

Selective recovery imports only whole missing visits, their positions, evidence, visit photos,
server drafts, linked messages and eligible saved reports, plus required parent records.
Existing visits/child IDs or duplicate visit identities cause rejection of the entire selection.
Existing parent IDs may be reused only when their stable identity matches; their data is never
overwritten. Cross-visit reports are omitted unless every referenced position is selected.
This mode does NOT repair individual missing images/records inside an existing visit.

Requests briefly receive HTTP 503 during the consistent snapshot and final restore. Retry after
maintenance. External scripts must not modify database/uploads during backups or restoration.
Jobs survive page reloads. An interrupted worker requires a new validation; inspect the dataset
before retrying an interrupted restore. SQLite commits are atomic, and pre-existing files are
never overwritten. Unreferenced recovery files after a hard crash are safe to retain.

Temporary jobs/downloads expire after the configured retention period (default 7 days).
Download recovery copies promptly. Configure VPS proxy request limits above the 8 MiB upload
chunk size (10 MiB or more); no single large upload or long-running restore request is required.
Keep the application release and separately secured deployment configuration for disaster recovery.
'''


def snapshot(destination, progress=lambda *a: None, allow_missing=False):
    """Called while the cross-worker exclusive maintenance barrier is held."""
    destination.mkdir(parents=True, exist_ok=True)
    database = destination / 'database.sqlite3'
    with connect(live_path()) as source, connect(database) as target:
        source.backup(target)
    with connect(database) as conn:
        conn.execute('PRAGMA journal_mode=DELETE')  # Package one self-contained database, even if the source uses WAL.
        check_database(conn)
        for table in EXCLUDED_TABLES:
            conn.execute(f'DELETE FROM "{table}"')
        conn.execute("UPDATE users SET hashed_password='!backup-password-excluded', is_active=0")
        conn.execute('UPDATE visit_entry_drafts SET last_commit_token=NULL')
        storage = roots()
        if any(settings.backups_dir.resolve().is_relative_to(base) or live_path().is_relative_to(base) for base in storage.values()):
            raise ValueError('Backup and database directories must be outside uploaded-file storage roots.')
        # Normalize legacy absolute references only if safely inside their configured root.
        for table, pk, field, root, value in list(file_references(conn)):
            path = Path(value)
            if path.is_absolute():
                if not path.resolve().is_relative_to(storage[root]):
                    raise ValueError(f'Attachment outside configured storage: {table} #{pk}.')
                value = path.resolve().relative_to(storage[root]).as_posix()
                conn.execute(f'UPDATE "{table}" SET "{field}"=? WHERE id=?', (value, pk))
            safe_relative(value)
        conn.commit()
        conn.execute('VACUUM')  # Remove deleted password/token bytes and freelist remnants.
        visits = summary(conn)
        by_visit = {v['id']: v for v in visits}
        position_visits = dict(conn.execute('SELECT id,visit_id FROM positions'))
        draft_visits = dict(conn.execute('SELECT id,visit_id FROM visit_entry_drafts'))
        owners = {}
        missing = []
        legacy_thumbnails = {}
        for table, pk, field, root, rel in [*file_references(conn), *inline_references(conn)]:
            row = conn.execute(f'SELECT * FROM "{table}" WHERE id=?', (pk,)).fetchone()
            visit_id = row['visit_id'] if 'visit_id' in row.keys() else position_visits.get(row['position_id']) if 'position_id' in row.keys() else draft_visits.get(row['draft_id']) if 'draft_id' in row.keys() else position_visits.get(pk) if table == 'positions' else None
            physical = resolve_file(storage[root], rel)
            if root == 'channel_thumbnails' and not physical.is_file():
                fallback = resolve_file(storage['channel'], rel)
                if fallback.is_file():
                    physical = fallback
                    legacy_thumbnails[rel] = fallback
            if not physical.is_file():
                if not allow_missing:
                    raise ValueError(f'Missing required attachment: {table} #{pk}, {field}.')
                missing.append({'table': table, 'id': pk, 'field': field, 'root': root, 'relative_path': rel})
            if visit_id in by_visit:
                owners.setdefault((root, rel), by_visit[visit_id])
        files = []
        for root, base in storage.items():
            if not base.exists() and not (root == 'channel_thumbnails' and legacy_thumbnails):
                continue
            candidates = [(path, path.relative_to(base).as_posix()) for path in sorted(base.rglob('*'))]
            if root == 'channel_thumbnails':
                candidates.extend((path, rel) for rel, path in legacy_thumbnails.items())
            for path, rel in candidates:
                if path.is_symlink():
                    raise ValueError('Symlink found in upload storage; backup stopped.')
                if not path.is_file() or (root == 'channel' and path.is_relative_to(storage['channel_thumbnails'])):
                    continue
                resolve_file(base, rel)
                owner = owners.get((root, rel))
                prefix = f"files/{slug(owner['line'])}/{slug(owner['tower_id'])}__tower-{owner['tower_pk']}/visit-{owner['id']}" if owner else 'files/supporting'
                archive = f'{prefix}/{root}/{rel}'
                target = destination / archive
                target.parent.mkdir(parents=True, exist_ok=True)
                if shutil.disk_usage(destination).free < path.stat().st_size + 128 * 1024**2:
                    raise ValueError('Insufficient disk space to create the backup.')
                shutil.copyfile(path, target)
                files.append({'path': archive, 'root': root, 'relative_path': rel, 'size': target.stat().st_size, 'sha256': digest(target)})
                progress('Copying attachments', len(files))
        members = [{'path': 'database.sqlite3', 'size': database.stat().st_size, 'sha256': digest(database)}]
        index = destination / 'inspection-index.csv'
        with index.open('w', encoding='utf-8-sig', newline='') as out:
            writer = csv.writer(out)
            writer.writerow(['Line/project','Tower','Tower ID','Visit ID','Visit date','Position ID','OHL','Phase','String','Direction','Result','Viewing side','Images in archive'])
            paths = {(f['root'],f['relative_path']): f['path'] for f in files}
            for visit in visits:
                positions = conn.execute('SELECT * FROM positions WHERE visit_id=? ORDER BY ohl,phase,string,direction,id', (visit['id'],)).fetchall() or [None]
                for pos in positions:
                    evidence = [paths.get(('images', r[0]), 'MISSING: ' + r[0]) for r in conn.execute('SELECT file_path FROM images WHERE position_id=? AND file_path IS NOT NULL', (pos['id'],))] if pos else []
                    cells = [visit['line'],visit['tower_id'],visit['tower_pk'],visit['id'],visit['inspection_date'],
                             *([pos[k] for k in ('id','ohl','phase','string','direction','screening_result')] if pos else [''] * 6), (pos['view_side'] if pos and 'view_side' in pos.keys() else 'Unspecified'), '; '.join(evidence)]
                    writer.writerow(["'"+x if isinstance(x,str) and x.startswith(('=','+','-','@')) else x for x in cells])
        readme = destination / 'RESTORE.txt'
        readme.write_text(instructions(), encoding='utf-8')
        members += [{'path': p.name, 'size': p.stat().st_size, 'sha256': digest(p)} for p in (index, readme)]
        manifest = {'format_version': FORMAT_VERSION, 'app_version': APP_VERSION, 'schema_version': schema_signature(),
                    'created_at': utcnow(), 'counts': counts(conn), 'files': files, 'members': members,
                    'visits': visits, 'exclusions': EXCLUSIONS, 'backup_id': str(uuid.uuid4()), 'missing_files': missing}
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest


def pack(directory, archive, progress=lambda *a: None):
    size = sum(p.stat().st_size for p in directory.rglob('*') if p.is_file())
    if size > settings.backup_max_archive_gb * 1024**3:
        raise ValueError('Backup exceeds the configured uncompressed archive size limit.')
    if shutil.disk_usage(archive.parent).free < size + 128 * 1024**2:
        raise ValueError('Insufficient disk space to package the backup.')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as z:
        for n, p in enumerate(sorted(directory.rglob('*'))):
            if p.is_file():
                z.write(p, p.relative_to(directory).as_posix())
                progress('Packaging backup', n)
    with archive.open('rb+') as stream:
        os.fsync(stream.fileno())
    sync_directory(archive.parent)


def validate_archive(archive, destination, progress=lambda *a: None):
    """Stream extraction, whitelist entries and reject bombs/traversal before any live writes."""
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        infos = z.infolist()
        if len(infos) > 500000 or len({i.filename.casefold() for i in infos}) != len(infos):
            raise ValueError('Archive has duplicate entries or too many files.')
        for info in infos:
            safe_relative(info.filename)
            if stat.S_ISLNK(info.external_attr >> 16) or info.is_dir() or info.flag_bits & 1:
                raise ValueError('Links, directories or encrypted entries are not supported.')
        if 'manifest.json' not in z.namelist() or z.getinfo('manifest.json').file_size > 64 * 1024**2:
            raise ValueError('Missing or oversized manifest.')
        manifest = json.loads(z.read('manifest.json'))
        if not isinstance(manifest, dict) or not all(isinstance(manifest.get(k), list) for k in ('files', 'members', 'visits')) or not isinstance(manifest.get('counts'), dict):
            raise ValueError('Malformed backup manifest.')
        if manifest.get('missing_files'):
            raise ValueError('This recovery snapshot records previously missing files. It is for manual recovery, not a complete import.')
        supported = {}
        for side in (False, True):
            for creation in (False, True):
                for snapshot in (False, True):
                    for relative in (False, True):
                        options = dict(before_view_side=side, before_creation_requests=creation,
                                       before_report_snapshot=snapshot, before_archive_relative_path=relative)
                        supported[schema_signature(**options)] = options
        if manifest.get('format_version') != FORMAT_VERSION or manifest.get('schema_version') not in supported or manifest.get('app_version') != APP_VERSION:
            raise ValueError('Incompatible backup format, application or schema version.')
        options = supported[manifest['schema_version']]
        before_creation_requests = options['before_creation_requests']
        expected = manifest.get('members', []) + manifest.get('files', [])
        for item in expected:
            if not isinstance(item, dict) or not isinstance(item.get('path'), str) or type(item.get('size')) is not int or item['size'] < 0 or not re.fullmatch(r'[a-f0-9]{64}', str(item.get('sha256', ''))):
                raise ValueError('Malformed backup file entry.')
        if {x['path'] for x in manifest['members']} != {'database.sqlite3','inspection-index.csv','RESTORE.txt'}:
            raise ValueError('Required database, index or instructions are missing.')
        if len({x['path'].casefold() for x in expected}) != len(expected) or set(z.namelist()) != {'manifest.json', *(x['path'] for x in expected)}:
            raise ValueError('Archive contents do not match the manifest.')
        total = sum(i.file_size for i in infos)
        if total > settings.backup_max_archive_gb * 1024**3 or shutil.disk_usage(destination).free < total + 128 * 1024**2:
            raise ValueError('Archive exceeds the size limit or available disk space.')
        for n, item in enumerate(expected):
            info = z.getinfo(item['path'])
            if item['size'] != info.file_size or info.compress_size and info.file_size / info.compress_size > 1000:
                raise ValueError('Invalid file size or excessive compression ratio.')
            target = destination / safe_relative(item['path'])
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, target.open('wb') as out:
                shutil.copyfileobj(src, out, 1024 * 1024)
            if digest(target) != item['sha256']:
                raise ValueError(f"Checksum mismatch: {item['path']}.")
            progress('Validating files', n + 1)
        lookup = {}
        for item in manifest['files']:
            if not isinstance(item.get('root'), str) or item['root'] not in roots() or not item['path'].startswith('files/'):
                raise ValueError('Unknown storage root.')
            key = (item['root'], safe_relative(item.get('relative_path')))
            if key in lookup:
                raise ValueError('Duplicate attachment mapping.')
            lookup[key] = item
        with connect(destination / 'database.sqlite3') as conn:
            check_database(conn, **options)
            if counts(conn, before_creation_requests=before_creation_requests) != manifest['counts'] or summary(conn) != manifest['visits']:
                raise ValueError('Manifest record counts or visit index do not match the database.')
            excluded = EXCLUDED_TABLES - ({'visit_creation_requests'} if before_creation_requests else set())
            if any(conn.execute(f'SELECT 1 FROM "{t}" LIMIT 1').fetchone() for t in excluded):
                raise ValueError('Archive contains excluded authentication records.')
            if conn.execute("SELECT 1 FROM users WHERE hashed_password != '!backup-password-excluded' OR is_active != 0 LIMIT 1").fetchone():
                raise ValueError('Archive contains credentials or enabled source accounts.')
            if conn.execute('SELECT 1 FROM visit_entry_drafts WHERE last_commit_token IS NOT NULL LIMIT 1').fetchone():
                raise ValueError('Archive contains excluded confirmation tokens.')
            for table, pk, field, root, rel in [*file_references(conn), *inline_references(conn)]:
                if (root, safe_relative(rel)) not in lookup:
                    raise ValueError(f'Missing required attachment: {table} #{pk}, {field}.')
        if any(options.values()):
            # Only the verified extracted copy is upgraded. The uploaded archive remains intact.
            # Restore inserts into trusted current tables, so its old unique constraint is harmless.
            with connect(destination / 'database.sqlite3') as conn:
                if options['before_view_side']:
                    conn.execute("ALTER TABLE positions ADD COLUMN view_side VARCHAR(16) NOT NULL DEFAULT 'Unspecified'")
                if options['before_report_snapshot']:
                    conn.execute('ALTER TABLE line_inspection_reports ADD COLUMN inspection_snapshot JSON')
                if options['before_archive_relative_path']:
                    conn.execute('ALTER TABLE team_archive_images ADD COLUMN relative_path VARCHAR(500)')
                if before_creation_requests:
                    conn.execute(str(CreateTable(models.VisitCreationRequest.__table__).compile(dialect=engine.dialect)))
                    for index in models.VisitCreationRequest.__table__.indexes:
                        conn.execute(str(CreateIndex(index).compile(dialect=engine.dialect)))
                check_database(conn)
                manifest['counts'] = counts(conn)
            manifest['source_schema_version'] = manifest['schema_version']
            manifest['schema_version'] = schema_signature()
            database = destination / 'database.sqlite3'
            for member in manifest['members']:
                if member['path'] == 'database.sqlite3':
                    member.update(size=database.stat().st_size, sha256=digest(database))
        (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    return manifest


PARENTS = {'towers': 'tower_id', 'teams': 'name', 'users': 'username', 'areas': 'name'}


def restore_plan(source, target, mode, visit_ids):
    """IDs are never renumbered during selective import. Conflicts reject the whole selection."""
    selected = {t: set() for t in Base.metadata.tables}
    skipped_reports = []
    if mode == 'full':
        for name, table in Base.metadata.tables.items():
            pk = next(iter(table.primary_key)).name
            selected[name] = {r[0] for r in source.execute(f'SELECT "{pk}" FROM "{name}"')}
    elif mode == 'selective':
        if not visit_ids or len(visit_ids) != len(set(visit_ids)):
            raise ValueError('Select one or more distinct missing visits.')
        selected['visits'] = set(visit_ids)
        for ident in visit_ids:
            visit = source.execute('SELECT * FROM visits WHERE id=?', (ident,)).fetchone()
            if not visit:
                raise ValueError(f'Visit #{ident} is not in this backup.')
            if target.execute('SELECT 1 FROM visits WHERE id=? OR (tower_id=? AND inspection_date IS ? AND team_id IS ? AND mission_seq IS ?)',
                              (ident, visit['tower_id'],visit['inspection_date'],visit['team_id'],visit['mission_seq'])).fetchone():
                raise ValueError(f'Visit #{ident} already exists or conflicts with an existing inspection. Selective recovery only restores missing visits.')
        for table in ('positions','visit_photos','visit_entry_drafts','team_channel_messages','night_tower_claims'):
            selected[table] = {r['id'] for r in source.execute(f'SELECT id,visit_id FROM "{table}"') if r['visit_id'] in selected['visits']}
        selected['images'] = {r['id'] for r in source.execute('SELECT id,position_id FROM images') if r['position_id'] in selected['positions']}
        selected['visit_draft_images'] = {r['id'] for r in source.execute('SELECT id,draft_id FROM visit_draft_images') if r['draft_id'] in selected['visit_entry_drafts']}
        report_positions = {}
        for row in source.execute('SELECT report_id,position_id FROM report_images'):
            report_positions.setdefault(row['report_id'], set()).add(row['position_id'])
        visits = [dict(r) for r in source.execute('SELECT * FROM visits')]
        for report in source.execute('SELECT * FROM line_inspection_reports'):
            ident = report['id']
            positions = report_positions.get(ident, set())
            scope = json.loads(report['scope_towers']) if report['scope_towers'] else None
            towers = {r['id'] for r in scope} if scope is not None else {report['tower_id']} if report['tower_id'] else None
            covered = {v['id'] for v in visits if v['inspection_date'] and report['start_date'] <= v['inspection_date'] <= report['end_date']
                       and (v['tower_id'] in towers if towers is not None else v['team_id'] == report['team_id'])}
            if covered & selected['visits'] or positions & selected['positions']:
                if covered <= selected['visits'] and positions <= selected['positions']:
                    selected['line_inspection_reports'].add(ident)
                else:
                    skipped_reports.append(ident)
        for table in ('report_images','report_comments'):
            selected[table] = {r['id'] for r in source.execute(f'SELECT id,report_id FROM "{table}"') if r['report_id'] in selected['line_inspection_reports']}
        # Resolve all foreign-key ancestors, including cycles between teams and user profiles.
        changed = True
        while changed:
            changed = False
            for name, ids in list(selected.items()):
                table = Base.metadata.tables[name]
                pk = next(iter(table.primary_key)).name
                for ident in list(ids):
                    row = source.execute(f'SELECT * FROM "{name}" WHERE "{pk}"=?', (ident,)).fetchone()
                    for col in table.columns:
                        for fk in col.foreign_keys:
                            parent, value = fk.column.table.name, row[col.name]
                            if value is not None and value not in selected[parent]:
                                selected[parent].add(value); changed = True
    else:
        raise ValueError('Unknown restore mode.')
    reused = {}
    for name, ids in selected.items():
        table = Base.metadata.tables[name]
        pk = next(iter(table.primary_key)).name
        for ident in list(ids):
            row = source.execute(f'SELECT * FROM "{name}" WHERE "{pk}"=?', (ident,)).fetchone()
            existing = target.execute(f'SELECT * FROM "{name}" WHERE "{pk}"=?', (ident,)).fetchone()
            stable = PARENTS.get(name)
            if mode == 'selective' and stable and not existing and target.execute(f'SELECT 1 FROM "{name}" WHERE "{stable}"=?', (row[stable],)).fetchone():
                raise ValueError(f'Conflicting identity: {name} #{ident} uses a different destination identifier.')
            if mode == 'selective' and existing:
                if not stable or existing[stable] != row[stable]:
                    raise ValueError(f'Conflicting identifier: {name} #{ident}. Nothing will be overwritten.')
                ids.remove(ident)
                reused[name] = reused.get(name, 0) + 1
    return selected, {'mode': mode, 'records_to_import': {t: len(ids) for t,ids in selected.items()},
                      'reused_parent_records': reused, 'omitted_cross_visit_reports': skipped_reports,
                      'replaces_existing_data': mode == 'full'}


def restore(validated, mode, visit_ids, operator_username, progress=lambda *a: None, before_commit=None):
    """Caller holds exclusive maintenance lock and has created a recovery backup.

    Files receive fresh names before the single DB transaction, so rollback/crash can leave
    only unreferenced files, never overwrite evidence or break the pre-existing database.
    """
    manifest = json.loads((validated / 'manifest.json').read_text(encoding='utf-8'))
    installed = []
    with connect(validated / 'database.sqlite3') as src, connect(live_path()) as dst:
        check_database(src)
        selected, plan = restore_plan(src, dst, mode, visit_ids)
        operator = dst.execute('SELECT * FROM users WHERE username=? AND role=? AND is_super_admin=1 AND is_active=1', (operator_username, 'admin')).fetchone()
        if not operator:
            raise ValueError('The restoring administrator is no longer authorized.')
        needed = set()
        for table, pk, field, root, rel in file_references(src):
            if pk in selected[table]:
                needed.add((root, rel))
        files = manifest['files'] if mode == 'full' else [f for f in manifest['files'] if (f['root'], f['relative_path']) in needed]
        path_map = {}
        try:
            for n, item in enumerate(files):
                original = PurePosixPath(item['relative_path'])
                rel = str(original.parent / (uuid.uuid4().hex + original.suffix))
                target = resolve_file(roots()[item['root']], rel)
                target.parent.mkdir(parents=True, exist_ok=True)
                if shutil.disk_usage(target.parent).free < item['size'] + 128 * 1024**2:
                    raise ValueError('Insufficient disk space to restore attachments.')
                with (validated / item['path']).open('rb') as source, target.open('xb') as out:
                    installed.append(target)
                    shutil.copyfileobj(source, out, 1024 * 1024)
                    out.flush(); os.fsync(out.fileno())
                if digest(target) != item['sha256']:
                    raise ValueError('Restored file checksum failed.')
                parent = target.parent
                root = roots()[item['root']]
                while parent.is_relative_to(root):
                    sync_directory(parent)
                    parent = parent.parent
                path_map[(item['root'], item['relative_path'])] = rel
                progress('Staging restored attachments', n + 1)
            dst.execute('PRAGMA foreign_keys=OFF')
            dst.execute('BEGIN IMMEDIATE')
            if mode == 'full':
                for name in Base.metadata.tables:
                    dst.execute(f'DELETE FROM "{name}"')
            for name, ids in selected.items():
                table = Base.metadata.tables[name]
                pk = next(iter(table.primary_key)).name
                for ident in ids:
                    row = dict(src.execute(f'SELECT * FROM "{name}" WHERE "{pk}"=?', (ident,)).fetchone())
                    for field, root in FILE_FIELDS.get(name, {}).items():
                        if row[field]:
                            row[field] = path_map[(root, row[field])]
                    if name == 'knowledge_documents' and row['body_html']:
                        for (root, old), new in path_map.items():
                            if root == 'knowledge_base' and old.startswith('inline/'):
                                row['body_html'] = row['body_html'].replace('/api/knowledge-base/inline-images/' + Path(old).name,
                                    '/api/knowledge-base/inline-images/' + Path(new).name)
                    cols = ','.join('"'+c+'"' for c in row)
                    dst.execute(f'INSERT INTO "{name}" ({cols}) VALUES ({",".join("?" for _ in row)})', list(row.values()))
            if mode == 'full':
                imported = dst.execute('SELECT id FROM users WHERE username=?', (operator_username,)).fetchone()
                if imported:
                    dst.execute('UPDATE users SET hashed_password=?,role=?,is_super_admin=1,is_active=1,is_approved=1,permissions_csv=?,menu_permissions_csv=? WHERE id=?',
                                (operator['hashed_password'],'admin',operator['permissions_csv'],operator['menu_permissions_csv'],imported['id']))
                else:
                    row = dict(operator)
                    row['id'] = dst.execute('SELECT COALESCE(MAX(id),0)+1 FROM users').fetchone()[0]
                    row['team_id'] = None
                    cols = ','.join('"'+c+'"' for c in row)
                    dst.execute(f'INSERT INTO users ({cols}) VALUES ({",".join("?" for _ in row)})', list(row.values()))
            check_database(dst)
            if before_commit:
                before_commit()
            dst.commit()
        except BaseException:
            dst.rollback()
            for path in installed:
                path.unlink(missing_ok=True)
            raise
    return plan
