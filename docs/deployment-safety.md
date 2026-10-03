# Safe release and recovery procedure

## What an update must preserve

Production's database, uploaded photographs, issued documents, environment settings,
authentication secret and push keys remain authoritative. Deploy code, not the local
development database or local storage. Never use the first-install bootstrap as an
update. A backend restart runs schema migrations and must be treated as a database
change. `scripts/pull-and-restart.sh` alone is not a complete safe release procedure.

## Current deployment plan

Prepared on 3 October 2026. This is a plan, not authorization to execute a release.
The live application remains in place. No push, production repair, restart or
deployment has been performed as part of preparing this document.

### Evidence already verified

- Live checkout: `53085b6f5afe3cc0def57ac2fcef67639d746e04`, clean worktree.
  The service is healthy, with the same process and zero restarts. Approximately
  205 GiB of server disk space was available at this planning check.
- Earlier local verification passed 560 backend tests, 130 frontend tests,
  TypeScript checking and the frontend build. The separate production-copy
  rehearsal tested migrations, inspection retries, evidence, customer permissions,
  comments and report exports.
  These are recorded earlier results, not a new full test run during planning.
- All 399 files in the tested source archive still match the local files. There
  are no additional application or test files in the checked source directories.
  Dependency manifests and the frontend lockfile have no pending Git differences.
  The improvements are still uncommitted; a fixed release commit has not been selected.
- The encrypted computer backup was decrypted and verified against every original
  database row and 14,594 original recovery files. Its snapshot is **3 October 2026
  at 13:19:10 Oman time**, containing 196 towers, 107 inspections and 12 issued
  reports. These are snapshot counts, not the expected counts at deployment time.
- Both the old portable backup and a newly generated portable backup were restored
  into independent empty destinations. A portable backup is not a substitute for
  the raw database, configuration, credentials and matching files needed for rollback.

The computer backup is outside OneDrive at
`C:\Users\nmtab\ServerBackups\InsulatorInspector-20261003-091910`.
Keep its encrypted archive, verification receipt and `keys` folder together.
The key password currently depends on Windows CurrentUser DPAPI. A separately
password-protected portable key export and a recovery test with that export remain
pending; do not request or store its password in chat, Git or a deployment document.

### Stage 1 Prepare the release while the site stays online

1. Review the intended tracked and untracked source changes, including the new
   modules and tests. Never stage the local database, uploads, environment files,
   private backup material or ignored operator helpers. Preserve unrelated edits.
2. Obtain approval before making a release commit or pushing it to GitHub. Identify
   the exact release commit and record the previously deployed commit. Do not deploy
   a moving `main` branch or assume the current HEAD includes uncommitted improvements.
3. Check for external deployment hooks before pushing. The repository workflow
   inspected here builds an Android APK on qualifying pushes to `main`; it does not
   deploy the VPS. External GitHub hooks, cron jobs or hosting integrations have not
   been comprehensively audited and must not be assumed absent.
4. Build and test the pinned release in a separate, non-public staging directory,
   without modifying the running checkout, Python environment or frontend output.
   Preserve dependency locks; do not combine this release with runtime upgrades.
   Preserve the live authentication secret, accounts, environment and push keys.
5. Repeat the production-copy rehearsal if source, dependencies or relevant live
   schema changed. Record the exact release and results before requesting cutover.

### Stage 2 Prepare fresh recovery and agree the maintenance window

1. Complete portable-key protection and its recovery test before relying on the
   computer copy as protection against a Windows reinstall or account loss.
2. Take a new coherent database and file snapshot, including the old source,
   frontend output and private configuration. Verify it and secure an encrypted,
   recovery-tested off-server copy. The existing 13:19 snapshot does not include
   work entered after that time.
3. If inspections resume while the bulk backup downloads, capture and verify the
   final database and changed-file delta during cutover, before migration. Any
   incremental method must first be rehearsed and prove it reconstructs the full
   final snapshot without missing changed or deleted files. Such a method is not
   implemented or certified by this plan. Otherwise allow time for a full final
   snapshot and verified transfer while writes are stopped.
4. Agree a maintenance window and rollback authority with the owner. Include time
   for draining requests, the final recovery copy, migration, checks and recovery
   if needed. The earlier snapshot-only pause is not approval for a new window,
   and its short duration is not an estimate of total deployment downtime.
   Ask inspectors to save their work and pause uploads. Unsynchronized browser or
   phone drafts are not in the server backup; preserve those drafts and test their
   reconciliation before asking staff to refresh or clear browser data.

### Stage 3 Cut over only after explicit approval

1. Put the application behind an agreed maintenance response, drain in-flight
   requests and stop all database/file writers. Include both backend workers,
   backup jobs and endpoints, thermal bridge processes and external scripts.
   The inspection maintenance barrier alone does not cover every external writer;
   backup endpoints and health checks are exempt from its request middleware.
2. Verify the final recovery snapshot and off-server recovery material before
   changing production. Record final counts, original-column row hashes, IDs,
   file hashes and schema. Never substitute the local development dataset.
3. Preview detached-draft recovery against the final snapshot. The earlier snapshot
   had 17 detached drafts and 71 child photo records; recount rather than assuming
   these numbers are unchanged. Archive exact records and file bytes before any
   separately approved removal from active draft tables. Never guess owners or
   create replacement inspections. Preserve source photographs and an off-server
   copy of the detached archive. Leave the release on hold if preservation fails.
4. Apply only the pinned and rehearsed release with writers stopped. Do not run
   `bootstrap-vps.sh` or the unchecked `pull-and-restart.sh` update path. Startup
   rebuilds position identity and repairs obsolete evidence foreign keys, adds
   report/archive fields and creates visit-creation retry receipts. Migration
   failures must stop the release, not be ignored.
5. Check migrations offline before starting the service where practical. If an
   external process holds the exclusive maintenance lock, release that lock before
   importing the new app: its startup also requires the exclusive lock. Keep the
   public maintenance response and other writer controls in place during this step.
6. Switch backend and frontend as one tested release. Keep the old frontend and
   required old assets for rollback and already-open browser tabs. Do not build
   directly into publicly served output. Ensure staging never defaults to live
   paths: the app derives database, storage and each attachment directory from its
   backend location unless explicitly configured. Inspect every effective path.
7. Keep public writes blocked until every acceptance check below passes. Test on
   the clone first; any deliberate production test entries, uploads or comments
   require approval and a plan for preserving or removing only those test records.

### Acceptance checks before reopening the application

- Database integrity passes and trusted foreign-key relationships are valid.
  All original IDs and original column values match the final pre-release baseline,
  except explicitly approved archived draft rows. New schema fields are accounted for.
- Historical position sides remain `Unspecified`; no copied positions, readings or
  guessed sides appear. Historical report snapshots remain NULL where none existed.
- All pre-existing reports and uploaded photographs match their original hashes,
  remain linked to the correct inspection, and open or download successfully.
- Administrator, inspector and customer permissions remain correct. Customers
  cannot reach another customer's data or administrator editing functions.
- Test evidence confirms inspection creation, draft save, photo upload and commit
  retries do not duplicate records. Zero readings are retained, stale draft changes
  are rejected, and the visual tower form opens and selects the correct positions.
- Existing reports can be viewed and downloaded. New PDF/Word exports and customer
  comments passed the pinned release rehearsal; inspect representative report layout
  and Arabic/English rendering rather than relying on a health endpoint alone.
- Health, public routing, static assets, service logs and required production
  integrations pass. Generate and restore a portable backup on an isolated copy.

### Rollback decision

Before reopening writes, any failed migration, data-preservation check, evidence
link, report download or permission check is a stop condition. Keep maintenance in
place. Under the agreed rollback authority, restore the prior source, compiled
frontend, original raw database and corresponding files/configuration as a matched
set. Use the exact final pre-release snapshot, not the earlier 13:19 backup. Stop all
database processes first and handle SQLite WAL/SHM files according to the rehearsed
restore method; stale sidecars must not be replayed onto the restored database.
Recheck recovery before reopening. Do not assume older code can use the new schema.

Once inspections resume, the rollback boundary changes: preserve the current
database and files, stop writes, and reconcile all newer work before any database
rollback. Never replace the database with an older snapshot simply to undo a UI bug.
For a proven schema-compatible UI-only issue, evaluate a limited code rollback;
otherwise keep data safe and seek explicit direction. Continue checking errors,
new inspection associations and reports after release; agree observation ownership
and duration rather than assuming an unattended monitor has been installed.

## Release gates

1. Review the intended diff and select a fixed release commit. Preserve unrelated local
   changes; do not reset a dirty checkout. Obtain separate approval for GitHub pushes,
   production repairs, restarts and deployment.
2. Inspect the live release, dependencies, schema, free space and service health without
   importing `app.main` against production during the audit.
3. Take a **fresh, consistent raw recovery backup** immediately before deployment.
   Include the SQLite snapshot, all uploaded storage, issued reports, exact old source
   and compiled frontend, environment configuration and service/proxy configuration.
   Coordinate database and file copies using the maintenance barrier and prohibit
   other file/database writers. Verify row counts, row hashes and attachment hashes.
4. Secure a verified off-server copy before relying on the recovery package. Raw
   backups contain credentials and secrets: private access only, never GitHub or a
   web-served directory. A secret-free portable ZIP is not an exact live rollback.
5. Rehearse the selected release against independent copies of the raw database and
   storage. Use separate secrets and disabled external integrations, no public staging
   exposure, and preferably an isolated network namespace. Verify old IDs, readings,
   accounts, report documents and evidence associations before and after migration.
6. Repair known obsolete `positions_old` child declarations transactionally. The
   startup repair changes only the declared photo parent; unresolved position IDs or
   custom triggers abort repair. It must not guess a photo's inspection position.
7. Investigate detached drafts separately. Their missing visit cannot be inferred from
   the draft. Preserve them as private recovery material; do not manufacture visits or
   silently assign them to another inspection.
8. Check database integrity, trusted relationships, duplicate identities and every
   required file. Create, validate and restore a new portable backup into an empty
   isolated destination. Test any required older backup format as well.
9. Run tests and build the frontend before switching production. Refresh dependencies
   in an isolated release environment if required; do not upgrade the running runtime
   as an untested side effect. Pin the exact tested release and dependency versions.
10. During an approved write pause, make the fresh recovery copy, apply only the
    rehearsed changes, restart the approved release and check health, permissions,
    inspection workflows, issued-document downloads, new report exports and customer
    comments. Reopen writes only when checks pass.

## Explicit detached-draft recovery

`app.services.detached_drafts` is **not called automatically at startup**. It requires
explicit database, image-root and private archive paths. First run without `--apply`
to preview counts. Run only after stopping all inspection writers and taking the raw
recovery backup. Example for an isolated copy, not a production instruction:

```sh
python -m app.services.detached_drafts \
  --database /private/rehearsal/database.sqlite3 \
  --images-root /private/rehearsal/storage/images \
  --archive /private/rehearsal/detached-draft-recovery
```

Applying requires **both** `--apply` and `--writes-stopped`. The archive stores every
original draft/child field in `records.json`, including original visit IDs, and copies
all associated files with SHA-256 checksums. It verifies and durably flushes recovery
material before committing removal from the active draft tables. Missing/unsafe files,
copy failures or changed records abort the transaction. Source photographs are never
deleted. Existing archive directories are never overwritten; a failed attempt may
leave partial recovery material and needs a new archive destination for a retry.

Keep this archive with the raw recovery backup, including its off-server copy. It is
not an ordinary application-import ZIP and is **not included automatically in portable
backups**. Its original IDs are recovery evidence, not proof of which current visit
owns the data. Reattachment needs separate investigation and explicit authorization.

## Legacy reports and backups

Existing report documents must remain immutable. Missing historical inspection
snapshots stay NULL; rebuilding them from today's edited readings would fabricate
history. New viewing-side fields use `Unspecified` for old records, never guessed
Front/Back assignments or duplicated readings.

The portable importer recognizes trusted earlier schemas missing viewing side,
creation receipts, report snapshots or archive relative paths. It still requires
matching manifests, checksums, table/column whitelists, safe paths, credential exclusion
and valid trusted relationships. Only a verified extracted copy is upgraded; the
uploaded ZIP is unchanged. Selective import rejects existing/conflicting visits and
must not be used to merge an old local database into a live project.

## Rollback boundary

Before writes resume, restore the exact prior source, compiled frontend, raw database
and corresponding attachment snapshot together if the release fails. Source-only
rollback may not reverse a schema change. Restoring an old database after inspections
resume loses intervening work: stop writes, preserve the current database/files and
reconcile newer inspections before any data rollback. Obtain approval rather than
discarding post-release work. Recovery tests reduce risk; they cannot guarantee every
future deployment or user operation will be failure-free.
