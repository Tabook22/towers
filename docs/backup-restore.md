# Backup and restore

Available in **Settings → Backup & Restore**, in English and Arabic, for **full administrators**. Restricted administrators, inspectors, team accounts and clients cannot call the backup API or download archives.

Your online instance is **https://skygreenline-lab.io/**. After the approved deployment, create/download the ZIP there, open the local application running on your computer, and upload the same ZIP through its Backup & Restore section. Both instances must run the compatible release containing this feature. File paths are translated to the local storage directories during restore; no VPS path or VPS login is needed by the local app. You can also inspect the ZIP's CSV and image folders directly without importing it.

## Make a backup

1. Choose **Create complete backup**. The server takes a consistent snapshot, copies attachments, then packages a ZIP in the background. The application temporarily returns `503 Retry-After: 10` while the snapshot is being copied.
2. Wait for **Complete**. Review the record counts, size and creation time, then **Download ZIP**. Keep a copy outside the VPS. Jobs continue when you leave Settings; file uploads require the page to stay open.
3. Keep downloaded files private. ZIPs contain confidential inspection and personnel information and **are not encrypted**. SHA-256 checksums detect corruption, not who produced the archive; import only trusted backups.

Archives are named `SkyGreenLine_Inspection_Backup_YYYY-MM-DD_HHMM.zip` (UTC). They contain:

- `database.sqlite3`: authoritative sanitized SQLite data, retaining IDs, timestamps, relationships, readings, metadata, report selections, permissions and server-side drafts.
- `manifest.json`: format version, application version, schema fingerprint, creation time, counts, visit index, logical storage mappings, file sizes and SHA-256 checksums.
- `inspection-index.csv`: line/project → tower → visit date → position index, including archive image paths. This is a readable export, not an import source.
- `files/<line>/<tower>__tower-<id>/visit-<id>/...`: visit-owned evidence. Shared files are under `files/supporting/<storage-root>/...`. A shared physical file is stored once; every database association is preserved.
- `RESTORE.txt`: portable recovery instructions and exclusions.

Included business records cover towers, areas, teams, visits, positions, original/annotated images and thumbnails, visit photographs, voice notes, server drafts, saved reports and their image/comment associations, uploaded report templates, team logs and attachments, channel files, team image archives, outings/claims, tracking records, notices/acknowledgements, knowledge-base documents/inline images, branding and application settings. Supporting files in the allowlisted upload folders are included even when no row references them.

Excluded: passwords/hashes, authentication and thermal-editor grants, push subscriptions/keys, transient live-call presence/invitations/signalling, `.env`, SSH credentials, API keys, deployment configuration, application code, old backup jobs and browser-only offline drafts. User-authored documents are copied as supplied; do not put credentials in inspection notes or attachments. Built-in report templates/fonts ship with the application release; retain that release separately. Uploaded templates are in the ZIP.

## Restore locally or on the VPS

Use the same compatible application release with file-backed SQLite. Configure the destination's own secrets and directories, bootstrap a full administrator using the existing installation procedure, and sign in. Do **not** copy the sanitized SQLite file over the live database manually: attachment paths must be remapped by the restore service.

1. **Upload and validate ZIP**. Uploads use resumable-offset chunks of at most 8 MiB, with automatic retries during the current page session. After a page reload during upload, start the upload again and remove the incomplete server copy. No single request carries the entire archive.
2. Choose **Preview recovery**; inspect towers, visits, positions, image records, saved-report counts and backup creation time.
3. Select a mode and choose **Check conflicts and preview restore**.
4. Review the resulting plan, acknowledge the changes and type **RESTORE**. The server validates the ZIP again, checks conflicts again under maintenance, and creates a mandatory pre-restore recovery ZIP before changing business data. Failure to make that copy aborts the restore.
5. Wait for **Restore complete**, download the pre-restore ZIP, and choose **Reload restored application**. Check visits and reports. Reset passwords and enable imported accounts deliberately.

### Full recovery

Replaces all business records with the archive dataset. The destination operator's username/password and full administrator access are retained: a source profile with the same username keeps its source ID, or a separate operator profile is added if absent. All other imported users are disabled and need password resets. Consequently a destination operator not present in the source adds one user to the source counts. Environment secrets are unchanged. Other staff should sign in again after recovery.

### Selective recovery

Imports **whole missing visits** with positions, images, voice notes, visit photos, server drafts, linked channel messages, claims and required foreign-key parent records. Eligible saved reports and their files/comments/image links are included only when their visit scope and referenced positions are within the selection. The preview lists reports omitted because they span unselected visits. Existing parent rows are reused only when their IDs and stable identities match; their values and permissions are not overwritten. Parents include towers, teams, users and areas. Team rosters, unrelated activity and organization settings are not merged.

Existing visit IDs, matching tower/date/team/mission identities, conflicting child IDs and parent identity mismatches reject the whole selection. IDs are not renumbered. This deliberately conservative mode is suitable for recovering visits deleted from the same dataset. Use full recovery for migration into a clean instance when IDs collide. **Repairing individual missing images/positions inside an existing visit is not implemented.**

## Reliability and operating limits

- A separate SQLite maintenance barrier coordinates all API workers on the **same host/local filesystem**, including the VPS's two-worker setup. Ordinary requests hold a shared lock through file streaming and background tasks; snapshot/restore takes an exclusive lock. Health and backup status endpoints remain available. Startup migrations use the barrier too. Do not run external database/upload mutation scripts during these operations. Network filesystems and multi-host writers are unsupported.
- The service streams file copies, ZIP operations and downloads. Temporary storage can require several times the source dataset: uploaded ZIP, extracted validation copy, restore recheck, pre-restore ZIP and newly staged files. Disk space is checked before and during copying, but reserve substantial headroom. Default archive/uncompressed limit: 100 GiB; maximum 500,000 archive entries. There is no production-scale throughput benchmark yet.
- Restored files receive fresh names and are checksum-checked before one database transaction commits. Failure rolls back database changes and removes newly staged files. Existing files are never overwritten. A hard process crash can leave unreferenced files, but cannot commit half a dataset. POSIX writes sync files and their directories before commit. A worker interrupted at the final commit may report **Interrupted** even if the commit completed: inspect the dataset, then re-upload/validate before retrying.
- Full recovery deliberately leaves previous uploaded files on disk for safety. It does not reclaim those files automatically. New backups include remaining supporting files. Remove them only through a separately reviewed storage audit after recovery is verified.
- Normal backups reject missing referenced files or inconsistent business relationships. If current attachments were already lost, a mandatory pre-restore snapshot records missing paths in `manifest.missing_files` and still preserves all remaining files; the UI marks it incomplete. That particular ZIP is for **manual recovery**, not automatic import. A structurally inconsistent current database requires manual repair before automatic recovery can proceed.
- Compatible format/application/schema versions must match exactly. Unknown tables, incompatible columns, executable schema objects, broken foreign keys, unsafe ZIP paths, duplicate entries, missing files and bad checksums are rejected. Schema changes in future releases need an explicit compatibility/migration policy.
- `BACKUPS_DIR` defaults to `backend/storage/backups`; keep it outside publicly served folders, owner-readable only, on a local disk, and shared by all workers. Private job directories use mode `0700` on POSIX. `BACKUP_RETENTION_DAYS` defaults to 7; terminal and abandoned-upload copies are pruned when a new job starts. You can remove a server copy manually in Settings. Active jobs and sources in use are protected. This is not a scheduled backup service.
- Configure nginx `client_max_body_size` at least `10m` for the 8 MiB chunks. Requests for creation, validation and restore return job IDs immediately; a proxy does not need to keep a restore request open. The deployment does not require business-table migrations or additional packages; two private SQLite coordination databases are created in `BACKUPS_DIR`.

## Verification

`backend/tests/test_backups.py` uses only synthetic data in temporary databases/directories. It verifies full and selective recovery, matching counts, position/image associations and bytes, restored visit/image API responses, PDF and OETC Word regeneration, CSV/manifest packaging, credential removal, duplicate/conflict rejection, corrupt/missing/traversal/version/orphan archives, transaction rollback, mandatory recovery-copy failure, already-missing attachments, authorization, chunk offsets and maintenance locks. Browser acceptance checks run on a separately restored synthetic local instance. No production restoration is used for testing.

Production deployment requires the owner's approval. A future separate enhancement could add scheduled encrypted off-server copies and retention policies; this implementation provides on-demand downloadable backups only.
