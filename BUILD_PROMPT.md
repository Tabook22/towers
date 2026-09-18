# Build Prompt — Insulator Inspector Pro

> Copy everything below into your coding assistant (Claude Code, etc.) as the project brief. It fully replaces the Excel workbook `Three_Tower_Insulator_Field_Inspection_Form_Date_Time_Pickers.xlsx` with a proper web application. The Excel structure was read cell-by-cell and is reproduced exactly (field names, dropdown values, ID-generation formulas, and business rules) — do not "simplify" or rename fields.

---

## 1. Role & mission

You are a senior full-stack engineer pairing with a certified high-voltage insulator inspection expert (thermography, hotspot/corona/flashover/contamination diagnostics on 132 kV overhead lines). Build **Insulator Inspector Pro**, an enterprise-grade field-inspection application that replaces a manual Excel workbook used to inspect insulator strings on transmission towers in the **Dufar** area.

The Excel workbook is the **exact functional specification**. Every field, dropdown value, computed formula, and validation rule listed below must exist in the app with the same meaning (labels may be prettified in the UI, but no field, enum value, or business rule may be dropped).

## 2. Tech stack (fixed)

- **Backend:** Python, **FastAPI**, **SQLite** (via SQLAlchemy + Alembic migrations). Pydantic v2 schemas.
- **Frontend:** **React** (Vite + TypeScript), a modern component library (e.g. MUI or shadcn/ui) for a polished enterprise look, React Query for data fetching, React Hook Form + Zod for form validation.
- **Maps:** Leaflet (with OpenStreetMap tiles) or MapLibre GL — pick one, must support: click-to-drop-pin, drag-to-adjust, manual lat/long entry, and reverse display of saved coordinates. No paid API keys.
- **File storage:** local filesystem, structured archive (see §6), served via FastAPI static/streaming endpoints with signed/authenticated URLs.
- **PDF/report generation:** e.g. WeasyPrint or ReportLab, generated server-side from the same data the UI shows.
- **Auth:** simple username/password with JWT sessions and at least two roles: `Inspector` (field data entry) and `Reviewer/Admin` (read, sign-off, export, user management).
- You may add any supporting library you need (image thumbnailing, EXIF GPS/time extraction, etc.) — the four items above are non-negotiable.

## 3. Domain model (derived from the workbook — build this exactly)

The workbook has one sheet per tower (`ARSD92`, `ARSD93`, `ARSD94`), a shared `Lists` sheet of dropdown values, a `Field Guide` sheet, and an `Overall Summary` roll-up. Normalize this into a relational schema:

### 3.1 Tower
**Towers must be fully user-manageable — not a fixed list.** The source workbook only had 3 hardcoded towers (`ARSD 92/93/94`) because Excel dropdowns can't grow dynamically; the app must remove that limitation entirely. Requirements:

- A **"Manage Towers"** screen (Admin/Reviewer role) to Create / Edit / Deactivate towers, independent of any Visit.
- **Tower ID is free text, chosen by the user, in any format they want** — not restricted to an `ARSDxx` pattern, not a fixed enum, not limited to 3 rows. Enforce only: non-empty, unique (case-insensitive), no leading/trailing whitespace. Support any real-world naming convention (`ARSD 92`, `T-114B`, `DUFAR-NORTH-07`, purely numeric IDs, etc.).
- There is **no upper limit** on the number of towers — the schema, list views, dashboard, and map must all be built to comfortably handle hundreds/thousands of towers (server-side pagination, search-by-ID/area, and filtering — do not assume a small in-memory list anywhere).
- A tower can be created ad hoc from the "New Visit" flow too (quick-add), not only from the management screen.
- Deleting a tower that already has Visits should be prevented or soft-deleted (deactivate instead), to preserve inspection history.

| Field | Notes |
|---|---|
| Tower ID | free text, user-defined, unique — no fixed pattern or list |
| Voltage | e.g. `132 kV` (free text/select, extend the list as needed) |
| Area/Region | e.g. `Dufar` — also user-manageable (support multiple areas/regions, not just Dufar) |
| GPS (tower base location) | lat/long via map picker |

### 3.2 Visit (Inspection Header) — one per tower per field visit
Mirrors the top block of each tower sheet (rows 3–8):

| Field | Type |
|---|---|
| Tower (FK) | select |
| Inspection date | date |
| Inspector | text (or FK to user) |
| GPS | lat/long (map picker) |
| Weather / wind | text |
| Electrical load | text/number |
| Camera / drone | text |
| Thermal mode | text |
| Emissivity | decimal |
| Reflected temperature | decimal |
| Permit / Job No. | text |

Header also drives the roll-up counters shown in §3.5.

### 3.3 Position — 12 fixed positions per tower (2 OHL circuits × 3 phases × 2 strings)
This is the flattened "one row = one image" structure in Excel, normalized: attributes that repeat identically across a position's 4 image rows become **Position** fields; attributes that vary per image become the **Image** child entity (§3.4).

| Field | Allowed values / type | Source |
|---|---|---|
| OHL (circuit) | `OHL1`, `OHL2` | Lists!H |
| Phase | `R`, `Y`, `B` | Lists!G |
| Insulator string | `S1`, `S2` | Lists!J |
| Direction | `EN` (East-North), `ES` (East-South), `WN` (West-North), `WS` (West-South) | Lists!F |
| Installed? | `Yes` / `No` | Lists!A |
| Screening result | `Normal`, `Hotspot detected`, `Inconclusive`, `Not visible`, `Not accessible`, `Reinspection required`, `Not installed`, `Not inspected`, `Corona`, `Contamination` | Lists!B — **note:** the source workbook has two misspellings, `Crona` and `Contimination`; store the corrected spellings `Corona` / `Contamination` in the app |
| Hotspot? | `Yes` / `No` / `Unconfirmed` | Lists!C |
| Tmax (°C) | decimal | manual entry |
| Tref (°C) | decimal | manual entry (comparable reference temperature) |
| ΔT (°C) | **computed** = Tmax − Tref | auto |
| Severity | `Normal`, `Low`, `Medium`, `High`, `Critical` | Lists!D |
| Confidence | `High`, `Medium`, `Low` | Lists!E |
| Inspector notes | free text | manual |
| Insulator-direction code | **computed** = `{String}-{Direction}`, e.g. `S1-ES` | auto, display-only |
| Position ID | **computed**, see §4 | auto |

24 (2×3×2×2 OHL circuits... — to be precise: 2 OHL × 3 phase × 2 string = **12 positions**) positions are created automatically per Visit when the tower/visit is created — do not make the user add them manually, but let them edit each one. Positions where `Installed? = No` are kept (not deleted) and Screening result defaults to `Not installed`, matching the workbook's guidance:

> "each tower may contain 6 strings (one per phase on each OHL) or 12 strings (two per phase). Keep all rows; mark Installed? = No and Screening result = Not installed for absent S2 positions."

### 3.4 Image — exactly 4 per Position
One row per `(Position, Image Type)` combination:

| Field | Allowed values / type |
|---|---|
| Image type | `TH Full` (thermal, full/context), `TH Close` (thermal, close-up/fault detail), `RGB Full` (visible-light, full/context), `RGB Close` (visible-light, close-up/fault detail) — Lists!K |
| Image ID | **computed**, see §4 |
| Capture date | date |
| Capture time | time, 1-minute-interval picker **but allow free manual entry down to the second** (the workbook's `Field Guide` explicitly says "Enter exact seconds manually when needed") |
| Longitude / Latitude | decimal degrees, from map picker or manual entry, validated to [-180,180]/[-90,90] |
| Evidence status | `NOT REQUIRED`, `PENDING CAPTURE`, `COMPLETE`, `RECAPTURE REQUIRED` |
| Uploaded file | thermal or RGB image file, see §6 |

**Evidence status auto-logic** (from the Field Guide rule "Normal strings do not require four detailed images"):
- If Position's Screening result = `Normal` (or `Not installed`), default `TH Close`/`RGB Close` rows to `NOT REQUIRED`.
- Otherwise (Hotspot detected / Inconclusive / Corona / Contamination / Reinspection required), all 4 image types default to `PENDING CAPTURE` until a file is uploaded.
- When a file is uploaded and passes basic validation → auto-set `COMPLETE`.
- User (Reviewer) can manually flag `RECAPTURE REQUIRED` (e.g. blurry, wrong angle) — this should prompt the inspector to re-upload.
- These are sensible **defaults**; always let the user override the status manually.

### 3.5 Overall Summary (dashboard roll-up)
Recreate the `Overall Summary` sheet as a live dashboard, one row per tower/visit, all computed from the Position/Image tables:

| Column | Formula (from workbook, reimplement server-side) |
|---|---|
| Possible positions | 12 (fixed) |
| Installed | count of Positions where Installed = Yes |
| Screened | count of Positions where Installed = Yes and Screening result not in (`Not inspected`, blank) |
| Hotspots | count of Positions where Hotspot? = Yes |
| Inconclusive | count of Positions where Screening result = Inconclusive |
| Images pending | count of Images where Evidence status not in (`COMPLETE`, `NOT REQUIRED`) — informational only, never blocks status |
| Completion % | Screened / Installed (0 if Installed = 0) |
| Visit status | `Inspection incomplete` if Screened < Installed; else `Ready for review` (a short photo checklist never holds a tower back — see 2026-09-18 change) |

Show this as a top-level dashboard across **all towers in the Dufar area** (and any future areas), plus drill-down per tower/visit.

## 4. ID generation (must match exactly)

**Position ID:**
```
PositionID = {TowerID, whitespace stripped}-{OHL}-{Phase}-{String}-{Direction}
example: ARSD92-OHL1-R-S1-ES   (for Tower ID "ARSD 92")
example: T-114B-OHL2-Y-S2-WN   (for Tower ID "T-114B", since arbitrary tower IDs must work)
```
Blank until Tower, OHL, Phase, String and Direction are all set. Since Tower ID is now free text (§3.1), the slugify step must handle any user-chosen ID safely — strip whitespace, keep the rest of the ID as typed (it may already contain hyphens), and just ensure the resulting Position ID stays unique per tower/OHL/Phase/String/Direction combination.

**Image ID:** `{PositionID}-{4-digit sequence}` where the sequence is deterministically derived from the indices of each attribute (0-based except Image Type which is 1-based), replicating the workbook formula:
```
ohl_idx   = index of OHL in [OHL1, OHL2]                      (0..1)
phase_idx = index of Phase in [R, Y, B]                       (0..2)
str_idx   = index of String in [S1, S2]                       (0..1)
dir_idx   = index of Direction in [EN, ES, WN, WS]             (0..3)
type_num  = 1-based index of Image Type in [TH Full, TH Close, RGB Full, RGB Close]  (1..4)

n = ((((ohl_idx * 3 + phase_idx) * 2 + str_idx) * 4 + dir_idx) * 4) + type_num
ImageID   = PositionID + "-" + zero_pad(n, 4)
```
This guarantees a unique, stable 4-digit code per Tower/OHL/Phase/String/Direction/ImageType combination (range 0001–0192). Generate both IDs server-side whenever the underlying fields change; never let the user hand-edit them.

## 5. Maps & geolocation

- Every **Visit** has one tower/base GPS point; every **Image** has its own capture lat/long (images are taken from different drone/ground positions).
- Provide an interactive map (Leaflet/MapLibre) on both the Visit form and each Image row: click to drop a pin, drag to fine-tune, and numeric lat/long fields kept in sync with the pin.
- Show a "site map" view: all towers plotted, colored/badged by worst current severity or Visit status, clickable to open that tower's latest visit.
- If the uploaded image file has EXIF GPS/timestamp metadata, offer to auto-fill Capture date/time/lat/long from EXIF (user can still override).

## 6. Image upload & archiving (critical requirement)

- Two **image kinds**: Thermal and RGB (visible light).
- Four **image categories** total, matching Image Type above: `TH Full`, `TH Close`, `RGB Full`, `RGB Close`. Every upload must be tagged with exactly one of these four categories — do not allow an untyped upload.
- On upload, the backend must:
  1. Validate the file is an accepted image type (plus radiometric thermal formats if applicable, e.g. `.jpg/.png` for processed thermal, `.rjpg`/`.seq`/manufacturer radiometric formats as a stretch goal — the Field Guide prefers "original radiometric files where available").
  2. Store it under a **date-partitioned archive**: `storage/images/{year}/{month:02}/{day:02}/{TowerID}/{ImageID}.{ext}` — the year/month/day come from the image's **Capture date**, not the upload date, so historical backfills archive correctly.
  3. Persist the original filename, the generated Image ID, file size, checksum, and content type in the DB, linked to the Image row.
  4. Generate a thumbnail/preview for fast gallery loading.
  5. Set Evidence status to `COMPLETE` (see §3.4 logic).
- Support drag-and-drop multi-file upload on a tower's image grid, auto-matching files to the right Image ID slot by filename when possible, with a manual fallback picker.
- Provide a gallery/lightbox view per Position (2×2 grid: TH Full / TH Close / RGB Full / RGB Close side by side) and a full archive browser (filter by year → month → day → tower → position).

## 7. Reporting

- **Per-tower report** (PDF, and on-screen): header info, 12-position table (mirroring the sheet layout), thermal readings, severity/hotspot flags, embedded thumbnails of the 4 images per flagged position, inspector notes, signature/sign-off block.
- **Overall/Dufar-area report**: the Overall Summary dashboard (§3.5) across all towers/visits in a date range, exportable to PDF and CSV/XLSX.
- Reports should be brandable (company logo/header placeholder) and print-friendly (A4).

## 8. UI/UX requirements

- Professional, enterprise-utility aesthetic — not a toy: clean typography, generous whitespace, a restrained brand palette, consistent iconography (map pin, thermal camera, RGB camera, alert triangle).
- **Color-code severity and status** consistently everywhere (list rows, badges, map markers, dashboard tiles): e.g. Normal = green, Low = yellow, Medium = amber/orange, High = red, Critical = deep red/purple; Hotspot = flame icon; Corona/Contamination = distinct badges.
- Guided data-entry flow that mirrors the Field Guide's 7 steps (confirm tower/OHL → confirm construction → thermally screen each string → assign direction → capture 4 images per position → record measurements → close the visit), including an "Evidence check" panel showing exactly which image slots are still pending before a visit can be marked complete.
- Dashboard home: KPI tiles (installed/screened/hotspots/inconclusive/images pending/completion %) per tower and rolled up for Dufar; a map widget; a "visits needing attention" list.
- Responsive enough for a tablet in the field, but the primary target is desktop/laptop office review.
- Light/dark theme support is a nice-to-have, not required.

## 9. Non-functional requirements

- Input validation matching the workbook's data-validation rules (dropdowns restricted to the enumerated lists; lat/long numeric ranges; date not in the future beyond a sane tolerance). The **Tower ID field is the one exception** — it must stay free text/unbounded, never a fixed dropdown, per §3.1.
- Full audit trail: created/updated timestamps and user on every Visit/Position/Image edit.
- Seed script that creates the 3 example towers (ARSD 92/93/94, 132 kV, Dufar) with their 12 positions each, ready for a demo visit.
- Automated tests: backend (pytest) for the ID-generation logic and roll-up calculations at minimum; a couple of frontend smoke tests.
- `README.md` with setup instructions (backend venv + `uvicorn`, frontend `npm install && npm run dev`) and a short architecture diagram/description.

## 10. Deliverable

A working monorepo:
```
/backend   (FastAPI app, SQLAlchemy models, Alembic migrations, image storage under /backend/storage)
/frontend  (React + TypeScript app)
README.md
```
Build it incrementally: (1) data model + migrations + seed data, (2) CRUD API for Tower/Visit/Position/Image with ID-generation and roll-up logic, (3) image upload/archiving endpoint, (4) React forms mirroring the workbook fields with map picker, (5) dashboard + gallery + reports, (6) auth/roles, (7) polish styling.

---

### Reference: exact dropdown lists from the workbook (`Lists` sheet)

- **Installed?** — Yes, No
- **Screening result** — Normal, Hotspot detected, Inconclusive, Not visible, Not accessible, Reinspection required, Not installed, Not inspected, Corona, Contamination *(source file had "Crona"/"Contimination" — use corrected spelling)*
- **Hotspot?** — No, Yes, Unconfirmed
- **Severity** — Normal, Low, Medium, High, Critical
- **Confidence** — High, Medium, Low
- **Direction** — EN, ES, WN, WS
- **Phase** — R, Y, B
- **OHL** — OHL1, OHL2
- **Insulator string** — S1, S2
- **Image Type** — TH Full, TH Close, RGB Full, RGB Close
- **Evidence status** — NOT REQUIRED, PENDING CAPTURE, COMPLETE, RECAPTURE REQUIRED
- **Tower ID** — user-defined, unlimited, any format (not a fixed list). Seed data for demo/testing only: ARSD 92, ARSD 93, ARSD 94, all 132 kV, area = Dufar — the "Manage Towers" screen must let the user add, edit, and deactivate any number of towers with any ID beyond these three.
