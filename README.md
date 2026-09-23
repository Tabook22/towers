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
2 strings); each Position has exactly 4 Images (`TH Full` / `TH Close` / `RGB Full` / `RGB Close`). Position and
Image IDs are generated server-side from the workbook's original formulas and are never user-editable.

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
or delete a report after confirmation if your role permits it. Deleting a report retains field
inspections and original evidence images.

New reports snapshot their tower membership so filters remain accurate after tower reassignment
or renaming. Existing databases receive the nullable scope column through the startup migration.
For older reports, tower membership is recovered from the selected tower or recorded evidence
where available. Reports without an archived file are marked **Live regeneration**: those copies
use current inspection data and may differ from the original. Line/project reports continue to
archive each team section separately; the combined document downloads at generation time.

Frontend filter/error regression tests: `cd frontend` then `npm test`.

## Image archive

The archive collects every page of inspection images and field photos, grouped by team, tower,
and insulator inspection. Thermal full, thermal close, RGB full and RGB close each have their
own gallery, including supplementary captures, original downloads and available annotations.
Capture months do not split one insulator's evidence into separate groups. Untagged field photos
remain visible under their tower. Search, team/tower filters, capture dates and inspection order
help navigate the collection; missing capture dates fall back to inspection or upload dates.

The report library's image action opens the archive filtered to the image references recorded
when that report was generated. Older reports without recorded references may show no matches;
clear the report filter to browse all uploads. References point to current image rows, so the
archived report document remains the record of the exact images embedded at generation time.
Archive regression tests: `cd backend` then `pytest tests/test_archive_completeness.py`.

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
