# Insulator Inspector Pro

An enterprise-grade field-inspection application for 132 kV overhead-line insulator strings, replacing the
`Three_Tower_Insulator_Field_Inspection_Form_Date_Time_Pickers.xlsx` workbook. See [BUILD_PROMPT.md](BUILD_PROMPT.md)
for the full functional specification this app implements.

## Architecture

```
/backend   FastAPI + SQLAlchemy + SQLite, Pydantic v2 schemas, JWT auth, image archiving, PDF reports
/frontend  React + TypeScript (Vite), MUI, React Query, React Hook Form, Leaflet maps
```

- **Backend** (`backend/app`): `routers/` expose REST endpoints (`auth`, `towers`, `visits`, `positions`, `images`,
  `archive`, `dashboard`, `reports`, `lists`); `services/` hold the domain logic — deterministic Position/Image ID
  generation (`id_gen.py`, `codes.py`), the roll-up/dashboard calculations (`rollup.py`), image archiving
  (`archive.py`), and PDF report generation (`reports.py`). Uploaded images are stored under
  `backend/storage/images/{year}/{month}/{day}/{TowerID}/{ImageID}.{ext}` with generated thumbnails alongside.
- **Frontend** (`frontend/src`): `pages/` are the routed screens (Dashboard, Towers, Tower detail, Visit detail,
  Archive, Reports, Login); `components/` hold shared UI (map picker, KPI tiles, severity/status badges, the
  position accordion and its 4-image evidence grid); `api/` wraps the backend with typed React Query hooks.

Data flow: a Tower has many Visits; each Visit auto-creates its 12 fixed Positions (2 OHL circuits × 3 phases ×
2 strings); each Position starts with 4 image slots (`TH Full` / `TH Close` / `RGB Full` / `RGB Close`) and can have supplementary images. Position and
Image IDs are generated server-side from the workbook's original formulas and are never user-editable.

## Field visit entry: one final confirmation

1. Open **Prepare tower positions**, choose circuits, strings and directions, and select
   **Use this layout**. Alternatively, **Add position** adds an individual position directly to
   the working checklist. Neither action needs an intermediate confirmation. Team leaders can
   remember the layout as this tower's template when the visit is confirmed.
2. Expand **Visit details** and fill in the header. A device-local equipment preset fills empty
   equipment/inspector fields; weather, load, readings and observations are not reused.
3. Select checklist rows and apply **Shared details** for manufacturer, installation year and
   insulator type. Empty fields are filled by default. Results, measurements, condition assessments,
   notes and evidence remain individual. Move between positions with **Previous/Next position**.
4. Add multiple photos using the four evidence-category buttons, or record a position voice note.
   Uploads go into a private working draft and retain their position/category association. They
   do not enter confirmed inspections or reports until final confirmation. Failed uploads can be
   retried while the page stays open; do not refresh with unsent files or recordings.
5. Use **Review and save visit** once. Review the header, layout, changed fields and evidence
   associations, then **Confirm and save visit**. The server saves the entire change together or
   rejects it without partially updating inspection records. A timestamped receipt appears only
   after server confirmation. Visit checks flag missing information; pending evidence remains
   informational under the existing report policy.

Fields are saved automatically on the device and synchronized to a private server draft when
connected. **Save draft and finish later** waits for that synchronization before leaving. Drafts
survive refresh; server drafts are available to the same account on another device. Simultaneous
editing on multiple devices raises a conflict instead of overwriting another draft. Unsynced
local edits are retained for recovery. Drafts are not visible to other inspectors or included in
reports. Final confirmation requires a connection and a cleared legacy visit outbox. Retry tokens
prevent duplicate confirmation and duplicate uploads after an ambiguous response.

Confirmed-record revision checks protect other inspectors' work. **Compare latest saved values**
refreshes the comparison for field edits while keeping proposed values; changed/deleted position
identities require a fresh selection. Evidence uploaded against a stale position must be removed
from the draft and uploaded again after checking the association. **Reload server draft** replaces
this device's copy, with an explicit warning to preserve any unsynced notes first.

Permanent deletion and replacement of existing evidence retain their existing safeguards. Editing
already-confirmed image metadata, report selection, thermal processing and the separate general
visit-photo archive remain immediate existing workflows. The single final review covers visit
fields, position entry and newly uploaded position evidence. Report downloads on the visit page
wait for draft entry and pending uploads. Existing report templates and archived documents remain
unchanged; regenerate documents when confirmed inspection data changes.

Preparation reuses empty baseline rows and excludes unused rows without deleting them. Positions
with recorded work cannot be omitted. Prepared positions become official findings only after
observations/evidence are recorded. Image IDs remain generated by the server, including stable
suffixes for collisions on repeat visits. The backend creates separate `visit_entry_drafts` and
`visit_draft_images` tables; existing inspection rows and report eligibility are preserved. Consumed
draft files are retained on disk for recovery and will need an explicit retention policy as usage
grows. Deploy frontend and backend together after the normal database/archive backup and verify
historical visit/report compatibility in staging.

Focused coverage is in `backend/tests/test_visit_entry.py`, `backend/tests/test_visit_workflow.py`,
`frontend/tests/visitEntry.test.mjs` and `frontend/tests/visitWorkflow.test.mjs`, alongside the
existing official-report and evidence tests.

### Starting inspections without accidental duplicates

Both visit-creation endpoints accept an optional UUID `request_token`. The client retains the
token and original request on this device until a response confirms the created visit. Repeating
that request returns the same visit and does not create another position/image checklist. Tokens
are scoped to the signed-in account; using one with a different request is rejected. A late retry
after deliberate deletion is rejected instead of recreating the inspection.

The team tower-work **Start inspection** action also sends `resume_existing: true`, which opens
the newest visit for that tower, team and inspection date if one exists. Concurrent starts from
different crew accounts therefore converge on the same visit. Explicit **New repeat visit** entry
continues to create a separate inspection after confirmation of its creation response. Clients
without a request token retain the original creation behavior. Mission numbering is allocated
under a team transaction lock, preserving existing numbers while preventing simultaneous new
requests from calculating the same number.

Inspection and planning date defaults follow the Oman calendar (`Asia/Muscat`) even when a
device uses a different timezone. Archive batches validate actual image bytes and per-file size
before storing any files. The new `visit_creation_requests` table is created at startup; its
receipts are excluded from exported backups, and earlier backup schemas remain importable.
Deploy frontend and backend together. Coverage: `backend/tests/test_visit_creation.py`,
`backend/tests/test_team_archive_upload.py`, `backend/tests/test_backups.py`,
`frontend/tests/visitCreation.test.mjs`, and `frontend/tests/teamTowerWork.test.mjs`.

## Dashboard tower history

Click **Towers** in **At a glance** to see visited towers and their visit history, including
the recorded team, inspector, inspection date, screening progress, hotspots, and pending images.
Search by tower, area, team, or inspector; switch to **All towers** to include planned-only and
unvisited towers. Each visit has a link to its inspection, and tower IDs open tower details.
The popup respects the selected dashboard area and the crew's tower/team access.
Use **Line** and **Visiting team** together to narrow the list. **Sort by** orders records by line,
visiting team, or tower number. Selecting a team shows only that team's visits and evaluates
recorded field activity for that team; sorting by team groups repeat visits under their actual
visiting teams. Rows are paginated after sorting, and missing dates appear last in each group.

“Visited” means a mission is in progress/completed, has a start time or closed inspection, or
has recorded photos, position direction, screening, or uploaded evidence. A scheduled date alone
does not count. This is recorded activity, not GPS verification. Missing dates/teams are shown
explicitly; the tower's current team assignment never substitutes for the team on a visit.

## Setup

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
python -m app.seed            # creates demo users + ARSD 92/93/94 (132 kV, Dufar) with 12 positions each
uvicorn app.main:app --reload --port 8000
```

The API listens on `http://127.0.0.1:8000` (docs at `/docs`). SQLite database and uploaded files live under
`backend/storage/`, created automatically on first run.

Demo logins (from the seed script): `admin` / `Admin123!` (Admin/Reviewer role) and `inspector1` / `Inspect123!`
(Inspector role). **Change both immediately on any server other people can reach** — see the security note at the
bottom of [DEPLOY.md](DEPLOY.md).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:5173` and talks to the API at `VITE_API_BASE_URL` (see `frontend/.env`, defaults
to `http://127.0.0.1:8000`).

### Tests

```bash
cd backend
pytest                        # ID-generation and roll-up calculation tests
```

## Report library

The Reports page opens on saved official reports. Search by report number, team, tower or line;
filter by team, tower, report type and overlapping inspection dates; and sort by creation date,
inspection date, team, tower or report number. Open documents in the viewer, download Word files,
or open the guided **Overview → Inspection data → Evidence → Discussion** review workspace.
Authorized accounts can also delete a report after confirmation. Deleting a report retains field
inspections and original evidence images.

New reports snapshot their tower membership so filters remain accurate after tower reassignment
or renaming. Existing databases receive the nullable scope column through the startup migration.
For older reports, tower membership is recovered from the selected tower or recorded evidence
where available. Reports without an archived file are marked **Live regeneration**: those copies
use current inspection data and may differ from the original. Line/project reports continue to
archive each team section separately; the combined document downloads at generation time.

Frontend filter/error regression tests: `cd frontend` then `npm test`.

Internal and customer accounts share the accessible, paginated report library. Advanced filters
are optional; latest-reply filters identify conversations whose last message came from the other
side, not an unread count or a formal approval status. Comments refresh every 30 seconds while
the Discussion step is active, retain drafts between steps, and prevent repeated submissions.

Newly generated official reports freeze customer-safe readings, notes, equipment/environment
details per visit, selected evidence references, and the original assessment. The review screen
and **Inspection data · PDF** register use that issue-time snapshot. Older reports are explicitly
labelled when no snapshot exists; no historical copy is fabricated from current field data.
Online assessment/sign-off edits do not change the archived Word document or register: issue a
new report for a revised deliverable. The supplied official Word template's layout is preserved.

Visit PDFs include wrapping field details and selected photographs; overall PDFs repeat table
headers across pages and wrap long tower names. Unicode exports require Arial (Windows) or
DejaVu Sans (Linux). Snapshot/permissions/PDF regressions: `pytest tests/test_report_snapshot.py`.

## Image archive

The archive collects every page of inspection images and field photos, grouped by team, tower,
and insulator inspection. Thermal full, thermal close, RGB full and RGB close each have their
own gallery, including supplementary captures, original downloads and available annotations.
Capture months do not split one insulator's evidence into separate groups. Untagged field photos
remain visible under their tower. Search, team/tower filters, capture dates and inspection order
help navigate the collection; missing capture dates fall back to inspection or upload dates.

The report review's Evidence step shows image references recorded when the report was generated.
Checksums flag replacements where the original checksum is known; legacy images are labelled
unverified. References point to current image rows, so the
archived report document remains the record of the exact images embedded at generation time.
Archive regression tests: `cd backend` then `pytest tests/test_archive_completeness.py`.

Admins, reviewers and a visit's own team leader can use **Replace image** on an evidence card.
Compare the current image with the selected file before saving. Replacement retains the image
slot, category and insulator, refreshes the thumbnail, and clears markup tied to the old pixels.
Previous files remain on disk for recovery. Primary slots are selected ahead of extra captures
when generating reports. Generate a new report to include replacements; existing saved documents
are unchanged. Invalid images and stale replacement requests are rejected.
Replacement/report regression tests: `pytest tests/test_archive_replace.py`.

## Faster tower inspection entry

Open a visit's **Visual tower form** and use **Quick inspection** (the default).
Check Drawing setup once, then tap a string on the compact tower navigator. Enter its screening
result, Tmax/Tref and evidence in the same editor; use **Next incomplete position** to continue.
Voice notes, position configuration and official-report fields remain available as disclosures.
**Detailed worksheet** retains the full drawing for inspectors who prefer it. Review and confirm
the whole visit once, or use Finish later to retain the working draft.

Only the chosen viewing side is prepared. Front/back, OHL, direction, phase and string identities
remain separate; switching the drawing never copies observations or relabels existing evidence.
Shared asset details fills manufacturer, installation year and insulator type for the current
view, with "Fill empty fields only" enabled by default. Measurements and findings are never copied.

Identical photo bytes for the same position/category are reused instead of creating another
image. Different positions, categories and visits remain separate. Confirmation checks the
evidence IDs shown during review; files added in another tab require a fresh review. Invalid
temperature input blocks navigation/confirmation, and invalid image files are rejected before
being marked complete. No historical duplicates are deleted or merged automatically.
Draft evidence requirements update immediately after a result change, following the same rules
as the server (for example, close-up categories are optional for Normal). Existing images and
explicit recapture flags are preserved. Temperature entry accepts Arabic and Western digits.

Regression coverage: `pytest tests/test_visit_entry.py tests/test_visit_workflow.py` in backend;
`node --test tests/*.test.mjs` in frontend, including draft-navigation isolation and conflict tests.

## Shared conversation

Messages is a common internal conversation for admins, reviewers, team leaders and members,
including accounts without a team assignment. Team filters only change the view: sending always
uses the signed-in person's identity and own team, and every internal participant can read it.
Client portal accounts remain excluded. Existing team messages and attachments are retained.

The chat includes outgoing/incoming bubbles, dates, emoji insertion, photo viewing, video/audio
players and document downloads. Attachments and voice recordings are reviewed before Send;
connection failures queue messages and attachments on-device for automatic retry. Validation failures retain the draft. Location is attached only after the user chooses to share it.
Tower assignment events are available using the Tower updates toggle. Search covers history,
and Load earlier messages uses ID-based pagination across field dates. Messages refresh every
eight seconds; the check mark means saved to the channel, not read by another participant.

Startup migrates the channel's team reference to allow unassigned internal authors. The SQLite
migration runs in an immediate transaction, preserves every existing column and rebuilds indexes.
Regression coverage: `pytest tests/test_community_chat.py`.

## Deployment

See [DEPLOY.md](DEPLOY.md) for step-by-step instructions to run this on a Hostinger VPS (or any Ubuntu server):
system packages, the backend as a systemd service, building the frontend, and an Nginx config that serves it and
reverse-proxies `/api` to the backend.

## Notes on deviations from the build brief

- Schema changes are applied via `Base.metadata.create_all()` at startup rather than Alembic migrations, since the
  schema has been stable since the initial build; introduce Alembic if the schema needs to evolve after real data
  has been collected.
- CSV/XLSX export of the overall summary report is not yet implemented — only the PDF export (`/api/reports/overall.pdf`,
  `/api/reports/visits/{id}.pdf`) exists today.
