"""SQLAlchemy ORM models.

Domain model, normalized from the source Excel workbook:
Tower -> Visit (one field visit) -> Position (12 fixed per visit:
2 OHL circuits x 3 phases x 2 strings) -> Image (4 per position:
TH Full / TH Close / RGB Full / RGB Close).
"""
from __future__ import annotations

import datetime as dt
import enum

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    REVIEWER = "reviewer"
    INSPECTOR = "inspector"
    # Scoped to exactly one team via User.team_id — sees and manages only that team's roster and
    # missions (Visits with that team_id). Enforced server-side in routers/teams.py, visits.py,
    # positions.py, and images.py, not just hidden in the UI. Admin/reviewer are unaffected — this
    # role only ever narrows access, never widens it.
    TEAM_LEADER = "team_leader"
    # A field worker with their own login, created by their team leader (or admin) — scoped even
    # narrower than TEAM_LEADER: not to the whole team, but to just the individual Visits
    # (missions) assigned to them via Visit.assigned_member_id. Full working access on those —
    # positions, images, screening, annotation, photos — same as a team_leader would have on any of
    # their team's visits, just narrowed to "assigned to me" instead of "belongs to my team". No
    # team/roster management, no cross-team or cross-member visibility.
    TEAM_MEMBER = "team_member"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default=UserRole.INSPECTOR.value)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    # The login this account's device pings/visits count toward for team tracking & progress —
    # nullable because not every login has to belong to a team (e.g. an office/admin account).
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True)
    # Profile fields for a team-leader account, set by the admin when creating the login — separate
    # from `team_id` (which team they currently lead, if any) since a leader profile can exist
    # before being assigned to a team. Meaningful for any role, but only ever populated in practice
    # for team_leader accounts (see routers/auth.py's create_user).
    mobile: Mapped[str | None] = mapped_column(String(60), nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free text (with suggested presets in the UI: Drone Operator, Photographer, Recorder / Data
    # Logger, Data Entry, Analyst) — a team_member's role on the crew, for display/filtering only,
    # not RBAC (that's `role` above). Meaningless for other roles.
    job_type: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # Teams also has a `created_by -> users.id` FK, so the join column has to be spelled out
    # explicitly here — otherwise SQLAlchemy can't tell which of the two FKs this relationship means.
    team: Mapped["Team | None"] = relationship(back_populates="users", foreign_keys=[team_id])


class Area(Base):
    """A named region/line a tower can belong to (e.g. "Ashoor-Saada", "Ittin-Thumrait") — the
    admin-managed catalog behind Tower.area. Deliberately NOT a foreign key on Tower: `Tower.area`
    stays the plain string it always was (every filter/report/dashboard that already reads it keeps
    working unchanged); this table is just the curated source of truth for which names exist and
    lets an admin add one before any tower uses it yet, rename one (cascades to every tower
    currently carrying the old name — see routers/areas.py), or delete one that's not in use."""

    __tablename__ = "areas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Tower(Base):
    """A transmission tower. Fully user-managed — any ID, unlimited count."""

    __tablename__ = "towers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tower_id: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    voltage: Mapped[str | None] = mapped_column(String(40), nullable=True)
    tower_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    area: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    # A named line segment this tower belongs to (e.g. "Ittin - Thumrait") — coarser than `area`,
    # used to group towers for project planning documents (see services/field_execution_plan.py),
    # not for day-to-day inspection tracking. Free text, admin-entered, optional.
    line_sector: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    # Which team is responsible for actually inspecting/fixing this tower — the direct, admin-set
    # source of truth for "whose job is this" (see routers/towers.py's bulk_assign_towers and
    # routers/teams.py's team_job_map). Deliberately separate from line_sector above: a sector is
    # just a descriptive label for planning documents, while this is the operational assignment —
    # a team's actual towers don't have to line up with one whole sector.
    assigned_team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
    location_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    height_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_path: Mapped[str | None] = mapped_column(String(400), nullable=True)
    photo_thumbnail_path: Mapped[str | None] = mapped_column(String(400), nullable=True)
    photo_original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    photo_uploaded_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    visits: Mapped[list["Visit"]] = relationship(back_populates="tower", cascade="all, delete-orphan")
    assigned_team: Mapped["Team | None"] = relationship(foreign_keys=[assigned_team_id])


class Visit(Base):
    """One field inspection visit to a tower."""

    __tablename__ = "visits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tower_id: Mapped[int] = mapped_column(ForeignKey("towers.id"), index=True)

    inspection_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    inspector_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    weather_wind: Mapped[str | None] = mapped_column(String(300), nullable=True)
    electrical_load: Mapped[str | None] = mapped_column(String(120), nullable=True)
    camera_drone: Mapped[str | None] = mapped_column(String(200), nullable=True)
    thermal_mode: Mapped[str | None] = mapped_column(String(120), nullable=True)
    emissivity: Mapped[float | None] = mapped_column(Float, nullable=True)
    reflected_temp: Mapped[float | None] = mapped_column(Float, nullable=True)
    permit_job_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # ---------- Equipment/environment fields the OETC report template asks for, captured once per
    # visit alongside camera_drone/thermal_mode/emissivity/reflected_temp above. ----------
    camera_serial_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    calibration_cert_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    calibration_due_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    distance_to_target_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    ambient_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    status: Mapped[str] = mapped_column(String(30), default="draft")  # draft | closed — is the DATA finished

    # A visit IS a team's mission when these are set — not a separate parallel record. A team's
    # "Mission 3" simply is the Visit with this team_id and mission_seq=3: same tower, same
    # positions/images/screening/reports as any other visit, just also carrying who it was assigned
    # to and when. `mission_status` tracks the ASSIGNMENT lifecycle (planned/in_progress/completed)
    # — independent of `status` above, which tracks whether the inspection DATA entry is finished;
    # a mission can be "completed" in the field while its data entry is still "draft" back at the office.
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
    mission_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_time: Mapped[dt.time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[dt.time | None] = mapped_column(Time, nullable=True)
    mission_status: Mapped[str] = mapped_column(String(20), default="planned", server_default="planned")
    # Which team_member this mission is assigned to, if any — a team_member's whole access to this
    # app is scoped to exactly the visits assigned to them here (see deps.check_visit_team_access),
    # not their whole team's missions the way a team_leader sees. Nullable: a team_leader can still
    # create/work missions without assigning them to a specific member (they just won't show up in
    # anyone's "my missions" workspace until assigned).
    assigned_member_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    tower: Mapped["Tower"] = relationship(back_populates="visits")
    team: Mapped["Team | None"] = relationship(back_populates="visits")
    assigned_member: Mapped["User | None"] = relationship(foreign_keys=[assigned_member_id])
    positions: Mapped[list["Position"]] = relationship(
        back_populates="visit", cascade="all, delete-orphan", order_by="Position.id"
    )
    photos: Mapped[list["VisitPhoto"]] = relationship(
        back_populates="visit", cascade="all, delete-orphan", order_by="VisitPhoto.uploaded_at"
    )


# The fixed 12 positions generated per visit: 2 OHL x 3 phase x 2 string
OHL_CHOICES = ["OHL1", "OHL2"]
PHASE_CHOICES = ["R", "Y", "B"]
STRING_CHOICES = ["S1", "S2"]
DIRECTION_CHOICES = ["EN", "ES", "WN", "WS"]
# Which of (sometimes) two physical insulator strings at the same OHL/Phase/String/Direction slot
# this one is — the one nearer the tower body ("Inner") vs. the one farther out ("Outer"). Purely
# descriptive (doesn't feed position/image code generation, unlike Direction) — most positions only
# have one insulator and leave this unset.
TOWER_PROXIMITY_CHOICES = ["Inner", "Outer"]
IMAGE_TYPE_CHOICES = ["TH Full", "TH Close", "RGB Full", "RGB Close"]

# ---------- Extra per-insulator record fields — the customer's official "Transmission Line
# Insulator Thermal Inspection Report" template (services/oetc_report.py) asks for each of these
# per finding; nothing else in the app needed them before that template existed. ----------
INSULATOR_TYPE_CHOICES = ["Composite", "Porcelain"]
MOUNT_TYPE_CHOICES = ["Suspension", "Tension"]
STRING_COUNT_CHOICES = ["Single", "Double"]
POLLUTION_CONDITION_CHOICES = ["Light", "Medium", "Heavy", "Severe"]
THERMAL_INDICATION_CHOICES = ["Hotspot", "Dry band", "Discharge track"]
# Multi-select — a Position's `visual_indications` stores any subset of these as a comma-joined
# string, since SQLite has no native array/set column type and these few short fixed labels don't
# warrant a whole separate table. Lowercased to match the OETC template's own wording exactly (its
# checkbox labels are "shed pending" / "cracks" / ... verbatim) so services/oetc_report.py's Jinja
# checks (`'cracks' in position.visual_indications`) don't need a casing translation step.
VISUAL_INDICATION_CHOICES = ["shed pending", "cracks", "erosion", "bird waste", "foreign material"]

SCREENING_RESULT_CHOICES = [
    "Not inspected",
    "Normal",
    "Hotspot detected",
    "Inconclusive",
    "Not visible",
    "Not accessible",
    "Reinspection required",
    "Not installed",
    "Corona",
    "Contamination",
]
HOTSPOT_CHOICES = ["No", "Yes", "Unconfirmed"]
SEVERITY_CHOICES = ["Normal", "Low", "Medium", "High", "Critical"]
CONFIDENCE_CHOICES = ["High", "Medium", "Low"]
EVIDENCE_STATUS_CHOICES = ["NOT REQUIRED", "PENDING CAPTURE", "COMPLETE", "RECAPTURE REQUIRED"]


class Position(Base):
    """One of the 12 fixed insulator-string positions on a tower for a visit."""

    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint("visit_id", "ohl", "phase", "string", name="uq_position_slot"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), index=True)

    ohl: Mapped[str] = mapped_column(String(10))
    phase: Mapped[str] = mapped_column(String(5))
    string: Mapped[str] = mapped_column(String(5))
    direction: Mapped[str | None] = mapped_column(String(5), nullable=True)
    # "Inner" (near the tower) or "Outer" (away from it) — for the occasional tower where this
    # slot actually carries two separate insulator strings at different distances from the tower.
    tower_proximity: Mapped[str | None] = mapped_column(String(10), nullable=True)

    installed: Mapped[bool] = mapped_column(Boolean, default=True)
    screening_result: Mapped[str] = mapped_column(String(40), default="Not inspected")
    hotspot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tmax_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    tref_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    severity: Mapped[str | None] = mapped_column(String(20), nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(20), nullable=True)
    inspector_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ---------- Insulator record fields for the OETC report template — all optional, all purely
    # descriptive (none feed position/image code generation). ----------
    manufacturer: Mapped[str | None] = mapped_column(String(120), nullable=True)
    year_installed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    insulator_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # Composite / Porcelain
    mount_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # Suspension / Tension
    gs_side: Mapped[str | None] = mapped_column(String(40), nullable=True)  # which side, only if Tension
    string_count: Mapped[str | None] = mapped_column(String(10), nullable=True)  # Single / Double
    pollution_condition: Mapped[str | None] = mapped_column(String(10), nullable=True)
    thermal_indication: Mapped[str | None] = mapped_column(String(20), nullable=True)
    visual_indications: Mapped[str | None] = mapped_column(String(200), nullable=True)  # comma-joined subset

    position_code: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    visit: Mapped["Visit"] = relationship(back_populates="positions")
    images: Mapped[list["Image"]] = relationship(
        back_populates="position", cascade="all, delete-orphan", order_by="Image.image_type"
    )

    @property
    def delta_t(self) -> float | None:
        if self.tmax_c is None or self.tref_c is None:
            return None
        return round(self.tmax_c - self.tref_c, 2)


class Image(Base):
    """An image for a position, tagged TH Full / TH Close / RGB Full / RGB Close.

    Every position starts with exactly 4 rows (sequence=1, one per type) — that baseline is what
    the deterministic Position/Image ID formulas (§4) and the evidence/roll-up counters are built
    on, and is never removed. A user can add further images of the same type afterward (sequence
    2, 3, ...) as supplementary gallery shots; those don't affect evidence-status/roll-up counting
    (see visit_rollup, which only counts sequence == 1) and can be freely deleted, unlike the
    baseline slot.
    """

    __tablename__ = "images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    position_id: Mapped[int] = mapped_column(ForeignKey("positions.id"), index=True)

    image_type: Mapped[str] = mapped_column(String(20))
    image_code: Mapped[str | None] = mapped_column(String(180), nullable=True, unique=True, index=True)
    sequence: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    capture_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    capture_time: Mapped[dt.time | None] = mapped_column(Time, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    evidence_status: Mapped[str] = mapped_column(String(30), default="NOT REQUIRED")

    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)  # relative to storage/images
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)

    uploaded_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    # A marked-up copy (circles/lines/rectangles drawn by the inspector to point at a fault) —
    # kept separate from file_path/thumbnail_path so the original evidence photo is never altered.
    annotated_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    annotated_thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    annotated_uploaded_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)

    position: Mapped["Position"] = relationship(back_populates="images")


REPORT_TEMPLATE_KINDS = ["docx", "pdf"]


class ReportTemplate(Base):
    """A user-uploaded template used to generate a custom-branded visit report — either a Word
    (.docx) mail-merge template filled via docxtpl (see services/docx_reports.py), or a fillable PDF
    form filled via pypdf (see services/pdf_form_reports.py); `kind` says which. Logo/colors/fonts/
    layout all come from the file itself in both cases — this row is just bookkeeping.

    `is_active` is scoped per `kind`: a docx and a pdf template can be active at the same time (they
    produce different output formats), but uploading a new one of a given kind deactivates the
    previous *same-kind* one only. Every upload keeps its row rather than overwriting one in place,
    so a previous template is never silently destroyed and could be reactivated later if needed,
    even though nothing in the UI does that today.
    """

    __tablename__ = "report_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Existing rows from before `kind` existed were always .docx uploads (the only kind that existed
    # then) — the server_default backfills them correctly via the additive auto-migration.
    kind: Mapped[str] = mapped_column(String(10), default="docx", server_default="docx")
    original_filename: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))  # relative to storage/report_templates
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


OVERALL_CONDITION_CHOICES = ["Acceptable", "Monitor", "Maintenance Required", "Urgent Action Required"]


class LineInspectionReport(Base):
    """One generated "official" OETC-format report (services/oetc_report.py) — a whole line/team's
    campaign over a date range, rendered into the customer's exact Word template. The raw readings
    it pulls from (Position/Visit/Tower) are never duplicated here; this row only keeps the things
    that exist ONLY at report time and can't be derived from the field data — the report number, the
    engineer's overall assessment/sign-off — so a past report's paperwork can be traced/reprinted
    later instead of living only as a one-off download."""

    __tablename__ = "line_inspection_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    start_date: Mapped[dt.date] = mapped_column(Date)
    end_date: Mapped[dt.date] = mapped_column(Date)
    report_number: Mapped[str] = mapped_column(String(80))

    overall_condition: Mapped[str | None] = mapped_column(String(30), nullable=True)
    probable_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrective_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    additional_comments: Mapped[str | None] = mapped_column(Text, nullable=True)

    prepared_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    approval_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    team: Mapped["Team"] = relationship()


class LocationPing(Base):
    """One GPS fix from a field user's device, sent while they have the app open in the field.
    A user's pings for a day, in order, form their movement trail along the transmission line —
    that's how the Field Tracker page draws each team's breadcrumb path and tells who's currently
    active (a recent ping) versus gone quiet. Deliberately just raw (user, place, time) rows — no
    separate "team" entity: each field crew is expected to share one login on one phone, so the user
    IS the team for tracking purposes (see routers/tracking.py for the read-side aggregation)."""

    __tablename__ = "location_pings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, index=True)

    user: Mapped["User"] = relationship()


class TrackingMission(Base):
    """A dispatcher-defined tracking session on the Field Tracker map.

    GPS pings are never deleted. Clicking "New mission" closes this row and opens a new one so the
    map can start clean; previous sessions stay listed and can be opened again at any time.
    """

    __tablename__ = "tracking_missions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String(200))
    started_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, index=True)
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


TEAM_STATUS_CHOICES = ["active", "paused", "completed"]


class Team(Base):
    """A field crew working a multi-day inspection mission — its own roster, its own assigned
    stretch of line, tracked day by day. Deliberately separate from `User`: a team is a real-world
    crew of people (leader + members, most of whom never log into this app), while `User.team_id`
    is just "which team does THIS LOGIN's device count toward" for GPS pings and visit-progress —
    usually one login per team (the leader's phone), sometimes a couple. See routers/teams.py for
    how daily progress is computed (from the team's linked users' Visit records, not stored here)."""

    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    leader_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    leader_phone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    mission: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free text on purpose — "from"/"to" for a field mission is often a place name or a tower ID
    # range ("ARSD 92 -> ARSD 110"), not a single GPS pin worth its own picker.
    mission_from: Mapped[str | None] = mapped_column(String(300), nullable=True)
    mission_to: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Which Tower.line_sector this team is primarily assigned to — drives the field execution plan
    # report's team/sector assignment table and its day-by-day schedule projection (see
    # services/field_execution_plan.py). Optional: a team without one just isn't auto-assigned a
    # primary sector in that report (falls back to assignment-by-order among unassigned teams).
    primary_sector: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # The team's daily working-plan quota — how many towers they're expected to cover in a day.
    # Compared against the real day-by-day count (see routers/teams.py's team_progress) so a team
    # leader (and the admin) can see at a glance whether a given day is on/behind target — a flat
    # number by design, not a per-day schedule, so it's one field to set and forget rather than
    # upkeep every team leader has to keep current.
    daily_target: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The linked login that leads this team — the authoritative source once set; `leader_name`/
    # `leader_phone` above get auto-filled from this account when it's assigned (see
    # routers/teams.py's _assign_leader) so anything already reading those two plain-text fields
    # (reports, the field execution plan, etc.) keeps working unchanged. Nullable: a team can still
    # have a free-text leader_name with no linked login yet, same as before this existed.
    leader_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    start_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    members: Mapped[list["TeamMember"]] = relationship(
        back_populates="team", cascade="all, delete-orphan", order_by="TeamMember.id"
    )
    daily_logs: Mapped[list["TeamDailyLog"]] = relationship(
        back_populates="team", cascade="all, delete-orphan", order_by="TeamDailyLog.log_date.desc()"
    )
    # A team's missions are just its Visits — see Visit.team_id/mission_seq. No separate table:
    # "Mission 3" IS Visit #whatever with team_id=this and mission_seq=3, with everything a visit
    # already carries (positions, images, screening, reports) automatically part of the mission.
    visits: Mapped[list["Visit"]] = relationship(back_populates="team", order_by="Visit.mission_seq")
    users: Mapped[list["User"]] = relationship(back_populates="team", foreign_keys="User.team_id")
    leader: Mapped["User | None"] = relationship(foreign_keys=[leader_user_id])
    channel_messages: Mapped[list["TeamChannelMessage"]] = relationship(
        back_populates="team", cascade="all, delete-orphan", order_by="TeamChannelMessage.id"
    )
    night_claims: Mapped[list["NightTowerClaim"]] = relationship(
        back_populates="team", cascade="all, delete-orphan", order_by="NightTowerClaim.id"
    )
    outing_plans: Mapped[list["TeamOutingPlan"]] = relationship(
        back_populates="team", cascade="all, delete-orphan", order_by="TeamOutingPlan.field_date.desc()"
    )


class TeamMember(Base):
    """One person on a team's roster (leader or member) — just contact info, not a login account."""

    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    national_id: Mapped[str | None] = mapped_column(String(60), nullable=True)  # national/employee ID number
    is_leader: Mapped[bool] = mapped_column(Boolean, default=False)
    role_title: Mapped[str | None] = mapped_column(String(120), nullable=True)  # e.g. "Drone Operator"
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    team: Mapped["Team"] = relationship(back_populates="members")


class TeamDailyLog(Base):
    """A dated note on a team's mission — a check-in, a delay explanation, a handover note. Multiple
    entries per day are fine (it's a log, not a single daily summary); the day's quantitative
    achievement (towers visited, screened, hotspots) is computed from Visit records, not stored
    here — see routers/teams.py's progress endpoint."""

    __tablename__ = "team_daily_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    log_date: Mapped[dt.date] = mapped_column(Date, index=True)
    note: Mapped[str] = mapped_column(Text)  # typed text and/or speech-to-text transcript
    audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    audio_content_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    audio_original_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    transcribed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    team: Mapped["Team"] = relationship(back_populates="daily_logs")
    files: Mapped[list["TeamDailyLogFile"]] = relationship(
        back_populates="log", cascade="all, delete-orphan", order_by="TeamDailyLogFile.id"
    )


class TeamDailyLogFile(Base):
    """A photo, PDF, or other site-visit file attached to a daily log note."""

    __tablename__ = "team_daily_log_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    log_id: Mapped[int] = mapped_column(ForeignKey("team_daily_logs.id"), index=True)
    file_path: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    log: Mapped["TeamDailyLog"] = relationship(back_populates="files")


MISSION_STATUS_CHOICES = ["planned", "in_progress", "completed"]

# Live night-shift thread (see routers/channel.py). Distinct from TeamDailyLog, which is a dated
# diary entry for reports — these are short ops messages the crew and dispatch share *during* the
# outing, optionally pinned to the nearest tower.
CHANNEL_KIND_CHOICES = ["note", "dispatch", "access", "weather", "skip", "hotspot", "help"]
CHANNEL_KIND_DEFAULT_BODY = {
    "note": "",
    "dispatch": "",
    "access": "Access problem",
    "weather": "Weather / wind hold",
    "skip": "Skipping this tower",
    "hotspot": "Hotspot — needs review before we leave",
    "help": "Need help",
}


class TeamChannelMessage(Base):
    """One message on a team's live night channel."""

    __tablename__ = "team_channel_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    field_date: Mapped[dt.date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(20), default="note", server_default="note")
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    tower_pk: Mapped[int | None] = mapped_column(ForeignKey("towers.id"), nullable=True, index=True)
    visit_id: Mapped[int | None] = mapped_column(ForeignKey("visits.id"), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    photo_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    photo_thumb_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    photo_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    photo_original_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    audio_content_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, index=True)

    team: Mapped["Team"] = relationship(back_populates="channel_messages")
    tower: Mapped["Tower | None"] = relationship(foreign_keys=[tower_pk])
    visit: Mapped["Visit | None"] = relationship(foreign_keys=[visit_id])
    author: Mapped["User | None"] = relationship(foreign_keys=[created_by])


class TeamOutingPlan(Base):
    """Towers the team leader picked for one field night — set before leaving for site."""

    __tablename__ = "team_outing_plans"
    __table_args__ = (UniqueConstraint("team_id", "field_date", name="uq_outing_plan_night"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    field_date: Mapped[dt.date] = mapped_column(Date, index=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    # Set when the leader taps End outing — the pack itself is still computed live; this just
    # records that tonight is closed and stores the handover note for the next crew.
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    ended_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    handover_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    team: Mapped["Team"] = relationship(back_populates="outing_plans")
    towers: Mapped[list["TeamOutingTower"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="TeamOutingTower.sort_order"
    )


class TeamOutingTower(Base):
    __tablename__ = "team_outing_towers"
    __table_args__ = (UniqueConstraint("plan_id", "tower_pk", name="uq_outing_tower"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("team_outing_plans.id"), index=True)
    tower_pk: Mapped[int] = mapped_column(ForeignKey("towers.id"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    plan: Mapped["TeamOutingPlan"] = relationship(back_populates="towers")
    tower: Mapped["Tower"] = relationship(foreign_keys=[tower_pk])


CLAIM_STATUS_CHOICES = ["claimed", "en_route", "on_site", "done", "skipped"]
ACTIVE_CLAIM_STATUSES = ["claimed", "en_route", "on_site"]


class NightTowerClaim(Base):
    """Who owns a tower on tonight's outing — so two cars don't drive to the same pin.

    Separate from Visit.assigned_member_id: a claim is the live night board (on my way / on site /
    skip). A visit is the inspection record, created when they tap Start.
    """

    __tablename__ = "night_tower_claims"
    __table_args__ = (UniqueConstraint("team_id", "field_date", "tower_pk", name="uq_night_claim_tower"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    field_date: Mapped[dt.date] = mapped_column(Date, index=True)
    tower_pk: Mapped[int] = mapped_column(ForeignKey("towers.id"), index=True)
    assigned_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="claimed", server_default="claimed")
    skip_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    visit_id: Mapped[int | None] = mapped_column(ForeignKey("visits.id"), nullable=True)
    claimed_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    arrived_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    team: Mapped["Team"] = relationship(back_populates="night_claims")
    tower: Mapped["Tower"] = relationship(foreign_keys=[tower_pk])
    assigned_user: Mapped["User"] = relationship(foreign_keys=[assigned_user_id])


class VisitPhoto(Base):
    """A photo uploaded straight to a visit — the simple, ad-hoc gallery for "here's what we saw",
    separate from the formal 48-shot Position/Image checklist (which needs a position + direction +
    image type picked first). Anyone can drop a photo here with no setup: a site overview, an access
    issue, anything that doesn't fit the formal per-position taxonomy. Both galleries live on the
    same Visit — whether or not that visit is also a team's mission."""

    __tablename__ = "visit_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), index=True)
    # Optional tag saying which insulator (position) this is a photo of — lets the gallery group by
    # position instead of one flat pile, and pre-selects that position when promoting the photo into
    # an official evidence slot. Left unset, a photo just sits in the "Ungrouped" bucket.
    position_id: Mapped[int | None] = mapped_column(ForeignKey("positions.id"), nullable=True)
    file_path: Mapped[str] = mapped_column(String(500))  # relative to storage/images
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    caption: Mapped[str | None] = mapped_column(String(500), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)  # from EXIF, if present
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    captured_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)  # from EXIF, if present
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    visit: Mapped["Visit"] = relationship(back_populates="photos")
    position: Mapped["Position | None"] = relationship()
