"""Pydantic schemas."""
from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import (
    CONFIDENCE_CHOICES,
    DIRECTION_CHOICES,
    EVIDENCE_STATUS_CHOICES,
    HOTSPOT_CHOICES,
    IMAGE_TYPE_CHOICES,
    INSULATOR_TYPE_CHOICES,
    MOUNT_TYPE_CHOICES,
    OHL_CHOICES,
    OVERALL_CONDITION_CHOICES,
    PHASE_CHOICES,
    POLLUTION_CONDITION_CHOICES,
    SCREENING_RESULT_CHOICES,
    SEVERITY_CHOICES,
    STRING_CHOICES,
    STRING_COUNT_CHOICES,
    THERMAL_INDICATION_CHOICES,
    TOWER_PROXIMITY_CHOICES,
    VISUAL_INDICATION_CHOICES,
)


# ---------- Auth ----------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    role: str
    username: str
    full_name: str | None = None
    team_id: int | None = None
    is_super_admin: bool = True
    permissions: list[str] = Field(default_factory=list)
    can_edit_reports: bool = False
    can_delete_report_images: bool = False


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    email: str | None = None
    full_name: str | None = None
    mobile: str | None = Field(default=None, max_length=60)
    address: str | None = Field(default=None, max_length=300)
    notes: str | None = None
    job_type: str | None = Field(default=None, max_length=80, description="e.g. Drone Operator, Photographer — team_member only")
    password: str = Field(min_length=6)
    role: str = "inspector"
    team_id: int | None = None  # set together with role="team_leader"/"team_member" to create-and-link in one step
    # Only meaningful for role="admin" — see models.User.is_super_admin/permissions_csv. Ignored
    # (forced to True/[]) for every other role. Only an existing super admin can even reach the
    # branch of the router that honors these (see routers/auth.py's _require_can_manage).
    is_super_admin: bool = True
    permissions: list[str] = Field(default_factory=list)
    # Only meaningful for role="client" — see models.User. Ignored for every other role.
    can_edit_reports: bool = False
    can_delete_report_images: bool = False


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: str | None
    full_name: str | None
    mobile: str | None = None
    address: str | None = None
    notes: str | None = None
    job_type: str | None = None
    role: str
    is_active: bool
    is_approved: bool = True
    team_id: int | None = None
    is_super_admin: bool = True
    permissions: list[str] = Field(default_factory=list)
    can_edit_reports: bool = False
    can_delete_report_images: bool = False


class UserUpdate(BaseModel):
    # Rotating a username is a real credential-hygiene need (e.g. the old one was exposed
    # alongside the password) — checked for uniqueness in the router same as UserCreate's.
    username: str | None = Field(default=None, min_length=3, max_length=80)
    email: str | None = None
    full_name: str | None = None
    mobile: str | None = None
    address: str | None = None
    notes: str | None = None
    job_type: str | None = None
    role: str | None = None
    is_active: bool | None = None
    # Admin-only (see routers/auth.py's update_user) — approves a self-registered account so it can
    # finally sign in. Never settable by a team_leader through this same route.
    is_approved: bool | None = None
    team_id: int | None = None
    is_super_admin: bool | None = None
    permissions: list[str] | None = None
    can_edit_reports: bool | None = None
    can_delete_report_images: bool | None = None
    # Lets an admin/team_leader reset someone's password for them (e.g. they're locked out) —
    # separate from the self-service change-password flow. Handled specially in the router (hashed
    # into hashed_password), never applied via the generic setattr loop.
    password: str | None = Field(default=None, min_length=6)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class UserRegister(BaseModel):
    """Public self sign-up (routers/auth.py's register()) — deliberately far narrower than
    UserCreate: no role, team, or permission fields, since an unvetted signup always lands as a
    plain team_member with no team and is_approved=False until an admin reviews it."""

    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=6)
    full_name: str | None = None
    mobile: str | None = Field(default=None, max_length=60)


# ---------- Area (the catalog behind Tower.area — see models.Area) ----------
class AreaCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    notes: str | None = None


class AreaUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    notes: str | None = None


class AreaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    notes: str | None
    tower_count: int = 0
    created_at: dt.datetime
    updated_at: dt.datetime


# ---------- Tower ----------
class TowerBase(BaseModel):
    tower_id: str = Field(min_length=1, max_length=120, description="User-defined, any format, unique")
    voltage: str | None = None
    tower_type: str | None = None
    area: str | None = None
    line_sector: str | None = Field(default=None, max_length=200, description="Named line segment, e.g. 'Ittin - Thumrait'")
    assigned_team_id: int | None = Field(default=None, description="Which team is responsible for inspecting this tower")
    location_name: str | None = Field(default=None, max_length=200, description="e.g. site/landmark name")
    height_m: float | None = Field(default=None, ge=0, le=1000, description="Tower height in metres")
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = None

    @field_validator("tower_id")
    @classmethod
    def strip_tower_id(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Tower ID cannot be empty")
        return v


class TowerCreate(TowerBase):
    pass


class TowerUpdate(BaseModel):
    tower_id: str | None = None
    voltage: str | None = None
    tower_type: str | None = None
    area: str | None = None
    line_sector: str | None = Field(default=None, max_length=200)
    assigned_team_id: int | None = None
    location_name: str | None = Field(default=None, max_length=200)
    height_m: float | None = Field(default=None, ge=0, le=1000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = None
    is_active: bool | None = None


class TowerOut(TowerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    assigned_team_name: str | None = None
    photo_path: str | None = None
    photo_thumbnail_path: str | None = None
    photo_original_filename: str | None = None
    photo_uploaded_at: dt.datetime | None = None
    created_at: dt.datetime
    updated_at: dt.datetime


class TowerWithStats(TowerOut):
    latest_visit_status: str | None = None
    # The assignment lifecycle state (planned/in_progress/completed) of the latest visit — distinct
    # from latest_visit_status above (which is the evidence/screening rollup) — used by the tower
    # map pins to show a "fully inspected" check badge regardless of team color.
    latest_visit_mission_status: str | None = None
    latest_visit_date: dt.date | None = None
    visit_count: int = 0
    open_hotspots: int = 0


class TowerBulkAssignRequest(BaseModel):
    tower_ids: list[int] = Field(min_length=1)
    team_id: int | None = None  # None = unassign


class TowerBulkDeleteRequest(BaseModel):
    tower_ids: list[int] = []
    delete_all: bool = False


class TowerBulkDeleteResult(BaseModel):
    deleted: int
    ids: list[int] = []


class TowerRenumberRequest(BaseModel):
    area: str | None = None  # if set, only that area; otherwise every area


class TowerRenumberChange(BaseModel):
    id: int
    old_id: str
    new_id: str
    pin_number: int


class TowerRenumberResult(BaseModel):
    updated: int
    unchanged: int
    changes: list[TowerRenumberChange] = []


class TowerClaimRequest(BaseModel):
    """Optional for a team leader (their own team is implied). Required for admin/reviewer."""
    team_id: int | None = None


class TowerImportResult(BaseModel):
    created: int
    updated: int
    total_rows: int
    warnings: list[str] = []


# ---------- Image ----------
class ImageUpdate(BaseModel):
    capture_date: dt.date | None = None
    capture_time: dt.time | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    evidence_status: str | None = None

    @field_validator("evidence_status")
    @classmethod
    def check_evidence(cls, v):
        if v is not None and v not in EVIDENCE_STATUS_CHOICES:
            raise ValueError(f"evidence_status must be one of {EVIDENCE_STATUS_CHOICES}")
        return v


class ImageRetype(BaseModel):
    new_type: str

    @field_validator("new_type")
    @classmethod
    def check_new_type(cls, v):
        if v not in IMAGE_TYPE_CHOICES:
            raise ValueError(f"new_type must be one of {IMAGE_TYPE_CHOICES}")
        return v


class ImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    position_id: int
    image_type: str
    image_code: str | None
    sequence: int = 1
    capture_date: dt.date | None
    capture_time: dt.time | None
    latitude: float | None
    longitude: float | None
    evidence_status: str
    file_path: str | None
    thumbnail_path: str | None
    original_filename: str | None
    file_size: int | None
    uploaded_at: dt.datetime | None
    annotated_path: str | None = None
    annotated_thumbnail_path: str | None = None
    annotated_uploaded_at: dt.datetime | None = None


class SmartEnhanceOut(BaseModel):
    # Base64 JPEG rather than a raw binary response — this rides alongside the geometry estimate
    # in one JSON body instead of needing a second round trip or custom multipart response.
    image_base64: str
    direction_deg: float
    pitch_px: float
    confidence: Literal["estimated", "fallback"]


class ArchiveImageOut(ImageOut):
    """ImageOut plus the Team/Tower/Position context needed to group the Image Archive page by
    team, then year/month, then line (Tower.area), then tower, then insulator (position) — nothing
    else needs this extra context, so it's kept off the shared ImageOut every other screen uses."""

    team_id: int | None = None
    team_name: str | None = None
    tower_pk: int
    tower_code: str
    area: str | None = None
    position_code: str | None = None
    ohl: str
    phase: str
    string: str
    direction: str | None = None


# ---------- Position ----------
class PositionUpdate(BaseModel):
    direction: str | None = None
    tower_proximity: str | None = None
    installed: bool | None = None
    screening_result: str | None = None
    hotspot: str | None = None
    tmax_c: float | None = None
    tref_c: float | None = None
    severity: str | None = None
    confidence: str | None = None
    inspector_notes: str | None = None

    # ---------- OETC report fields (see models.py's Position for what each drives) ----------
    manufacturer: str | None = None
    year_installed: int | None = None
    insulator_type: str | None = None
    mount_type: str | None = None
    gs_side: str | None = None
    string_count: str | None = None
    pollution_condition: str | None = None
    thermal_indication: str | None = None
    visual_indications: str | None = None  # comma-joined subset of VISUAL_INDICATION_CHOICES

    @field_validator("direction")
    @classmethod
    def check_direction(cls, v):
        if v is not None and v not in DIRECTION_CHOICES:
            raise ValueError(f"direction must be one of {DIRECTION_CHOICES}")
        return v

    @field_validator("tower_proximity")
    @classmethod
    def check_tower_proximity(cls, v):
        if v is not None and v not in TOWER_PROXIMITY_CHOICES:
            raise ValueError(f"tower_proximity must be one of {TOWER_PROXIMITY_CHOICES}")
        return v

    @field_validator("screening_result")
    @classmethod
    def check_screening(cls, v):
        if v is not None and v not in SCREENING_RESULT_CHOICES:
            raise ValueError(f"screening_result must be one of {SCREENING_RESULT_CHOICES}")
        return v

    @field_validator("hotspot")
    @classmethod
    def check_hotspot(cls, v):
        if v is not None and v not in HOTSPOT_CHOICES:
            raise ValueError(f"hotspot must be one of {HOTSPOT_CHOICES}")
        return v

    @field_validator("severity")
    @classmethod
    def check_severity(cls, v):
        if v is not None and v not in SEVERITY_CHOICES:
            raise ValueError(f"severity must be one of {SEVERITY_CHOICES}")
        return v

    @field_validator("confidence")
    @classmethod
    def check_confidence(cls, v):
        if v is not None and v not in CONFIDENCE_CHOICES:
            raise ValueError(f"confidence must be one of {CONFIDENCE_CHOICES}")
        return v

    @field_validator("insulator_type")
    @classmethod
    def check_insulator_type(cls, v):
        if v is not None and v not in INSULATOR_TYPE_CHOICES:
            raise ValueError(f"insulator_type must be one of {INSULATOR_TYPE_CHOICES}")
        return v

    @field_validator("mount_type")
    @classmethod
    def check_mount_type(cls, v):
        if v is not None and v not in MOUNT_TYPE_CHOICES:
            raise ValueError(f"mount_type must be one of {MOUNT_TYPE_CHOICES}")
        return v

    @field_validator("string_count")
    @classmethod
    def check_string_count(cls, v):
        if v is not None and v not in STRING_COUNT_CHOICES:
            raise ValueError(f"string_count must be one of {STRING_COUNT_CHOICES}")
        return v

    @field_validator("pollution_condition")
    @classmethod
    def check_pollution_condition(cls, v):
        if v is not None and v not in POLLUTION_CONDITION_CHOICES:
            raise ValueError(f"pollution_condition must be one of {POLLUTION_CONDITION_CHOICES}")
        return v

    @field_validator("thermal_indication")
    @classmethod
    def check_thermal_indication(cls, v):
        if v is not None and v not in THERMAL_INDICATION_CHOICES:
            raise ValueError(f"thermal_indication must be one of {THERMAL_INDICATION_CHOICES}")
        return v

    @field_validator("visual_indications")
    @classmethod
    def check_visual_indications(cls, v):
        if v is None or v == "":
            return v
        bad = [tok for tok in v.split(",") if tok not in VISUAL_INDICATION_CHOICES]
        if bad:
            raise ValueError(f"visual_indications entries must be from {VISUAL_INDICATION_CHOICES}, got {bad}")
        return v


class PositionCreate(BaseModel):
    """Adds an *extra* position beyond a visit's 12 baseline slots — only ever needed for a
    Tension-type tower carrying the same OHL/phase/string out toward a second line Direction (see
    models.Position and routers/visits.py's add_extra_position). Rejected if this exact
    (ohl, phase, string, direction) already exists on the visit."""

    ohl: str
    phase: str
    string: str
    direction: str
    mount_type: str | None = None

    @field_validator("ohl")
    @classmethod
    def check_ohl(cls, v):
        if v not in OHL_CHOICES:
            raise ValueError(f"ohl must be one of {OHL_CHOICES}")
        return v

    @field_validator("phase")
    @classmethod
    def check_phase(cls, v):
        if v not in PHASE_CHOICES:
            raise ValueError(f"phase must be one of {PHASE_CHOICES}")
        return v

    @field_validator("string")
    @classmethod
    def check_string(cls, v):
        if v not in STRING_CHOICES:
            raise ValueError(f"string must be one of {STRING_CHOICES}")
        return v

    @field_validator("direction")
    @classmethod
    def check_direction(cls, v):
        if v not in DIRECTION_CHOICES:
            raise ValueError(f"direction must be one of {DIRECTION_CHOICES}")
        return v

    @field_validator("mount_type")
    @classmethod
    def check_mount_type(cls, v):
        if v is not None and v not in MOUNT_TYPE_CHOICES:
            raise ValueError(f"mount_type must be one of {MOUNT_TYPE_CHOICES}")
        return v


class PositionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    visit_id: int
    ohl: str
    phase: str
    string: str
    direction: str | None
    tower_proximity: str | None
    installed: bool
    screening_result: str
    hotspot: str | None
    tmax_c: float | None
    tref_c: float | None
    severity: str | None
    confidence: str | None
    inspector_notes: str | None
    manufacturer: str | None = None
    year_installed: int | None = None
    insulator_type: str | None = None
    mount_type: str | None = None
    gs_side: str | None = None
    string_count: str | None = None
    pollution_condition: str | None = None
    thermal_indication: str | None = None
    visual_indications: str | None = None
    position_code: str | None
    voice_note_path: str | None = None
    voice_note_content_type: str | None = None
    voice_note_original_filename: str | None = None
    voice_note_duration_seconds: float | None = None
    voice_note_transcript: str | None = None
    images: list[ImageOut] = []

    @property
    def delta_t(self) -> float | None:
        if self.tmax_c is None or self.tref_c is None:
            return None
        return round(self.tmax_c - self.tref_c, 2)


# ---------- Visit ----------
class VisitBase(BaseModel):
    tower_id: int
    inspection_date: dt.date | None = None
    inspector_name: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    weather_wind: str | None = None
    electrical_load: str | None = None
    camera_drone: str | None = None
    thermal_mode: str | None = None
    emissivity: float | None = None
    reflected_temp: float | None = None
    permit_job_no: str | None = None
    # ---------- Equipment/environment fields for the OETC report template — captured once per visit,
    # alongside camera_drone/thermal_mode/emissivity/reflected_temp above. ----------
    camera_serial_no: str | None = None
    calibration_cert_no: str | None = None
    calibration_due_date: dt.date | None = None
    distance_to_target_m: float | None = None
    ambient_temp_c: float | None = None
    humidity_pct: float | None = None
    # Set these to make this visit a team's mission — same record, nothing separate. mission_seq is
    # assigned server-side (next number for that team) and can't be set directly on create.
    team_id: int | None = None
    start_time: dt.time | None = None
    end_time: dt.time | None = None
    mission_status: str = "planned"
    # Which team_member is responsible for actually working this mission — see
    # models.Visit.assigned_member_id / UserRole.TEAM_MEMBER for what this scopes.
    assigned_member_id: int | None = None


class VisitCreate(VisitBase):
    pass


class VisitUpdate(BaseModel):
    inspection_date: dt.date | None = None
    inspector_name: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    weather_wind: str | None = None
    electrical_load: str | None = None
    camera_drone: str | None = None
    thermal_mode: str | None = None
    emissivity: float | None = None
    reflected_temp: float | None = None
    permit_job_no: str | None = None
    camera_serial_no: str | None = None
    calibration_cert_no: str | None = None
    calibration_due_date: dt.date | None = None
    distance_to_target_m: float | None = None
    ambient_temp_c: float | None = None
    humidity_pct: float | None = None
    status: str | None = None
    team_id: int | None = None
    start_time: dt.time | None = None
    end_time: dt.time | None = None
    mission_status: str | None = None
    assigned_member_id: int | None = None


class VisitRollup(BaseModel):
    possible_positions: int
    installed: int
    screened: int
    hotspots: int
    inconclusive: int
    images_pending: int
    completion_pct: float
    visit_status: str


class VisitOut(VisitBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    mission_seq: int | None = None
    team_name: str | None = None
    assigned_member_name: str | None = None
    created_at: dt.datetime
    updated_at: dt.datetime
    tower: TowerOut | None = None
    rollup: VisitRollup | None = None
    photo_count: int = 0


class VisitDetail(VisitOut):
    positions: list[PositionOut] = []


# ---------- Report templates ----------
class ReportTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    original_filename: str
    uploaded_at: dt.datetime


class ReportTemplatesActive(BaseModel):
    docx: ReportTemplateOut | None = None
    pdf: ReportTemplateOut | None = None


# ---------- Dashboard ----------
class DashboardTowerRow(BaseModel):
    tower: TowerOut
    latest_visit: VisitOut | None = None
    rollup: VisitRollup | None = None


class DashboardSummary(BaseModel):
    tower_count: int
    visit_count: int
    total_hotspots: int
    total_images_pending: int
    rows: list[DashboardTowerRow]


# ---------- Teams (crews, rosters, multi-day missions) ----------
class TeamMemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = None
    national_id: str | None = None
    is_leader: bool = False
    role_title: str | None = None
    notes: str | None = None


class TeamMemberUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    national_id: str | None = None
    is_leader: bool | None = None
    role_title: str | None = None
    notes: str | None = None


class TeamMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    team_id: int
    name: str
    phone: str | None
    national_id: str | None
    is_leader: bool
    role_title: str | None
    notes: str | None


class TeamDailyLogCreate(BaseModel):
    log_date: dt.date
    note: str = Field(min_length=1)


class TeamDailyLogUpdate(BaseModel):
    note: str = Field(min_length=1)


class TeamDailyLogFileUpdate(BaseModel):
    original_filename: str = Field(min_length=1, max_length=300)


class TeamDailyLogFileOut(BaseModel):
    id: int
    original_filename: str | None = None
    content_type: str | None = None
    file_size: int | None = None
    is_image: bool = False
    is_pdf: bool = False


class TeamDailyLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    team_id: int
    log_date: dt.date
    note: str
    has_audio: bool = False
    transcribed: bool = False
    audio_content_type: str | None = None
    duration_seconds: float | None = None
    attachments: list[TeamDailyLogFileOut] = []
    created_by: int | None
    created_by_name: str | None = None
    created_at: dt.datetime


class TeamBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    leader_name: str | None = None
    leader_phone: str | None = None
    leader_user_id: int | None = Field(default=None, description="A team-leader login to link as this team's leader — see routers/teams.py")
    mission: str | None = None
    mission_from: str | None = None
    mission_to: str | None = None
    primary_sector: str | None = Field(default=None, max_length=200, description="A Tower.line_sector this team is primarily assigned to")
    daily_target: int | None = Field(default=None, ge=0, le=500, description="Working-plan quota: towers/day this team is expected to cover")
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    status: str = "active"
    notes: str | None = None


class TeamCreate(TeamBase):
    members: list[TeamMemberCreate] = []


class TeamUpdate(BaseModel):
    name: str | None = None
    leader_name: str | None = None
    leader_phone: str | None = None
    leader_user_id: int | None = None
    mission: str | None = None
    mission_from: str | None = None
    mission_to: str | None = None
    primary_sector: str | None = None
    daily_target: int | None = Field(default=None, ge=0, le=500)
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    status: str | None = None
    notes: str | None = None
    is_active: bool | None = None


class TeamOut(TeamBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    created_at: dt.datetime
    updated_at: dt.datetime
    members: list[TeamMemberOut] = []
    linked_user_count: int = 0
    # How many missions (Visits) this team has ever run — shown in the delete confirmation so an
    # admin knows exactly how much is about to be destroyed (see routers/teams.py's delete_team,
    # which erases all of them, not just unlinks the team).
    mission_count: int = 0


# ---------- Team job map — every tower in the team's assigned sector, done vs. pending, so a
# leader (and field crew) can see the whole scope of work on one map, not just what's been visited
# so far. See routers/teams.py's team_job_map. ----------
class TeamJobMapTower(BaseModel):
    id: int
    tower_id: str
    area: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    status: str  # "completed" | "in_progress" | "pending"
    visit_id: int | None = None


class TeamJobMap(BaseModel):
    sector: str | None = None
    total: int = 0
    completed: int = 0
    in_progress: int = 0
    pending: int = 0
    towers: list[TeamJobMapTower] = []


class OutingPlanTowerOut(BaseModel):
    id: int
    tower_id: str
    area: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    sort_order: int = 0


class OutingPlanOut(BaseModel):
    team_id: int
    field_date: dt.date
    name: str | None = None
    start_time: dt.time | None = None
    end_time: dt.time | None = None
    tower_ids: list[int] = []
    towers: list[OutingPlanTowerOut] = []
    notes: str | None = None


class OutingPlanSave(BaseModel):
    field_date: dt.date | None = None
    name: str | None = None
    start_time: dt.time | None = None
    end_time: dt.time | None = None
    tower_ids: list[int] = []
    notes: str | None = None


class OutingPlanSummary(BaseModel):
    """One row of a team's mission history — enough to list, sort, and pick a mission to open
    without fetching every tower on every night."""

    field_date: dt.date
    name: str | None = None
    start_time: dt.time | None = None
    end_time: dt.time | None = None
    tower_count: int = 0
    notes: str | None = None
    ended_at: dt.datetime | None = None
    created_at: dt.datetime
    updated_at: dt.datetime


class HandoverTower(BaseModel):
    id: int
    tower_id: str
    area: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    status: str
    visit_id: int | None = None
    visit_status: str | None = None
    images_pending: int = 0
    hotspots: int = 0
    claim_status: str | None = None
    skip_reason: str | None = None
    claimed_by_name: str | None = None


class HandoverHotspot(BaseModel):
    tower_id: str
    tower_pk: int
    visit_id: int
    position_id: int
    position_code: str | None = None
    ohl: str
    phase: str
    string: str
    tmax_c: float | None = None
    tref_c: float | None = None
    delta_t: float | None = None
    severity: str | None = None
    image_id: int | None = None


class HandoverEvent(BaseModel):
    id: int
    kind: str
    body: str
    tower_id: str | None = None
    tower_pk: int | None = None
    visit_id: int | None = None
    created_at: dt.datetime
    author_name: str | None = None


class HandoverNote(BaseModel):
    id: int
    note: str
    has_audio: bool = False
    transcribed: bool = False
    created_at: dt.datetime
    created_by_name: str | None = None


class HandoverRecommend(BaseModel):
    id: int
    tower_id: str
    area: str | None = None
    latitude: float
    longitude: float
    reason: str
    travel_km: float | None = None
    visit_id: int | None = None


class HandoverGps(BaseModel):
    latitude: float
    longitude: float
    recorded_at: dt.datetime
    user_name: str | None = None


class HandoverPack(BaseModel):
    team_id: int
    team_name: str
    field_date: dt.date
    scope: str
    total: int = 0
    completed: int = 0
    skipped: int = 0
    in_progress: int = 0
    pending: int = 0
    remaining: int = 0
    headline: str = ""
    ended_at: dt.datetime | None = None
    ended_by_name: str | None = None
    handover_note: str | None = None
    last_gps: HandoverGps | None = None
    recommended: HandoverRecommend | None = None
    previous_field_date: dt.date | None = None
    previous_remaining: int = 0
    towers: list[HandoverTower] = []
    hotspots: list[HandoverHotspot] = []
    events: list[HandoverEvent] = []
    notes: list[HandoverNote] = []
    unfinished_visits: list[HandoverTower] = []
    continued_from: dt.date | None = None


class HandoverEnd(BaseModel):
    note: str | None = None
    field_date: dt.date | None = None


class HandoverContinue(BaseModel):
    field_date: dt.date | None = None
    from_date: dt.date | None = None
    replace: bool = False


class NextTowerStop(BaseModel):
    rank: int
    id: int
    tower_id: str
    area: str | None = None
    latitude: float
    longitude: float
    status: str
    visit_id: int | None = None
    travel_km: float
    travel_minutes: int
    dwell_minutes: int
    cumulative_minutes: int
    fits_tonight: bool = True
    reason: str
    claim_id: int | None = None
    claim_status: str | None = None
    claimed_by_id: int | None = None
    claimed_by_name: str | None = None
    mine: bool = False
    skip_reason: str | None = None


class NightClaimCrewMember(BaseModel):
    user_id: int
    username: str
    full_name: str | None = None
    role: str


class NightClaimCreate(BaseModel):
    tower_id: int  # Tower.id
    assigned_user_id: int | None = None  # default: the caller


class NightClaimUpdate(BaseModel):
    status: str | None = None
    assigned_user_id: int | None = None
    skip_reason: str | None = None
    visit_id: int | None = None


class NightClaimOut(BaseModel):
    id: int
    team_id: int
    field_date: dt.date
    tower_id: int
    tower_code: str | None = None
    assigned_user_id: int
    assigned_user_name: str | None = None
    status: str
    skip_reason: str | None = None
    visit_id: int | None = None
    claimed_at: dt.datetime
    arrived_at: dt.datetime | None = None
    completed_at: dt.datetime | None = None


class NextTowersPlan(BaseModel):
    team_id: int
    team_name: str
    field_date: dt.date
    origin_latitude: float | None = None
    origin_longitude: float | None = None
    origin_source: str
    origin_label: str
    minutes_left: int
    still_night: bool
    daily_target: int | None = None
    towers_done_tonight: int
    behind_by: int | None = None
    remaining_assigned: int
    in_progress: int
    pending: int
    completed: int
    skipped_no_gps: int = 0
    can_fit_tonight: int
    dwell_minutes: int
    headline: str
    stops: list[NextTowerStop] = []
    crew: list[NightClaimCrewMember] = []


class ChannelMessageCreate(BaseModel):
    kind: str = "note"
    body: str = ""
    tower_id: int | None = None  # Tower.id (pk)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class ChannelMessageOut(BaseModel):
    id: int
    team_id: int
    team_name: str | None = None
    field_date: dt.date
    kind: str
    body: str
    tower_id: int | None = None
    tower_code: str | None = None
    visit_id: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    has_photo: bool = False
    has_audio: bool = False
    duration_seconds: float | None = None
    has_video: bool = False
    has_file: bool = False
    file_name: str | None = None
    file_size: int | None = None
    created_by: int | None = None
    author_name: str | None = None
    author_role: str | None = None
    # Lets the Messages page offer one-tap "Call" / "WhatsApp" buttons back to whoever sent this —
    # see components/NightChannel.tsx's MessageBody. None when the author has no number on file.
    author_mobile: str | None = None
    created_at: dt.datetime


class ChannelUnreadOut(BaseModel):
    unread_count: int
    latest_id: int | None = None


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys
    user_agent: str | None = None


class PushUnsubscribe(BaseModel):
    endpoint: str


class VapidKeyOut(BaseModel):
    public_key: str


class VisitPhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    visit_id: int
    position_id: int | None = None
    position_code: str | None = None  # e.g. "ARSD92-OHL1-R-S1-EN" — which insulator this is a photo of
    original_filename: str | None
    file_size: int | None
    caption: str | None
    latitude: float | None
    longitude: float | None
    captured_at: dt.datetime | None
    uploaded_by: int | None
    uploaded_at: dt.datetime


class VisitPhotoUpdate(BaseModel):
    caption: str | None = None
    position_id: int | None = None


class VisitPhotoPromote(BaseModel):
    """Turns a free-form visit photo into the official evidence for one specific checklist image
    slot — same file, now archived and reported the same way any other position image is. Targets
    the exact Image row picked (the baseline or a specific extra), replacing whatever's there now.
    The source photo stays in the free-form gallery — it isn't removed just because it was also
    used to fill a slot."""

    image_id: int


class ArchiveVisitPhotoOut(VisitPhotoOut):
    """VisitPhotoOut plus the same Team/Tower context ArchiveImageOut adds to ImageOut — lets the
    Image Archive page fold these free-form photos into the same team/tower tree as the formal
    checklist images (see routers/archive.browse_archive)."""

    team_id: int | None = None
    team_name: str | None = None
    tower_pk: int
    tower_code: str
    area: str | None = None
    ohl: str | None = None
    phase: str | None = None
    string: str | None = None
    direction: str | None = None


class ArchiveOut(BaseModel):
    """The Image Archive page's two datasets for one tower/team/date filter: the formal
    per-position checklist images, and the free-form visit photos (some tagged to a position, some
    not) — kept separate since they have different shapes rather than forcing one into the other's
    schema."""

    images: list[ArchiveImageOut]
    photos: list[ArchiveVisitPhotoOut]


class TeamDayProgress(BaseModel):
    log_date: dt.date
    towers_visited: int
    visits_touched: int
    screened: int
    hotspots: int
    images_captured: int
    first_seen: dt.datetime | None = None  # earliest GPS ping that day — the day's "start time"
    last_seen: dt.datetime | None = None
    ping_count: int = 0
    path_km: float = 0
    notes: list[TeamDailyLogOut] = []


# ---------- Field tracking (live team locations + daily progress) ----------
class LocationPingCreate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=50_000)


class TrackingMissionOut(BaseModel):
    id: int | None = None
    kind: str
    label: str
    field_date: dt.date
    started_at: dt.datetime
    ended_at: dt.datetime | None = None
    is_current: bool = False
    ping_count: int = 0


class TrailPoint(BaseModel):
    latitude: float
    longitude: float
    recorded_at: dt.datetime


class UserTrailOut(BaseModel):
    user_id: int
    username: str
    full_name: str | None = None
    team_name: str | None = None
    field_date: dt.date | None = None
    is_previous: bool = False
    points: list[TrailPoint]


class TowerStayOut(BaseModel):
    tower_pk: int
    tower_id: str
    area: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    arrived_at: dt.datetime
    departed_at: dt.datetime
    minutes: int
    visit_id: int | None = None
    visit_status: str | None = None
    travel_from_prev_minutes: int | None = None
    travel_from_prev_km: float | None = None


class TeamProgressLoginOut(BaseModel):
    user_id: int
    username: str
    full_name: str | None = None


class TeamProgressDeltaOut(BaseModel):
    field_date: dt.date
    minutes_tracked_delta: int
    distance_km_delta: float
    towers_delta: int
    avg_minutes_per_tower_delta: float


class TeamProgressOut(BaseModel):
    team_id: int | None = None
    team_name: str
    field_date: dt.date
    started_at: dt.datetime
    ended_at: dt.datetime
    start_latitude: float
    start_longitude: float
    end_latitude: float
    end_longitude: float
    minutes_tracked: int
    distance_km: float
    towers_visited: int
    dwell_minutes: int
    travel_minutes: int
    avg_minutes_per_tower: float
    avg_travel_minutes: float
    ping_count: int
    logins: list[TeamProgressLoginOut]
    stays: list[TowerStayOut]
    path: list[TrailPoint]
    vs_previous: TeamProgressDeltaOut | None = None


class MovementDayReportOut(BaseModel):
    user_id: int
    username: str
    full_name: str | None = None
    team_id: int | None = None
    team_name: str | None = None
    first_seen: dt.datetime
    last_seen: dt.datetime
    minutes_tracked: int
    distance_km: float
    ping_count: int
    path: list[TrailPoint]
    stays: list[TowerStayOut]


class TeamTodayProgress(BaseModel):
    towers_visited: int
    visits_touched: int
    screened: int
    hotspots: int


class LiveTeamMember(BaseModel):
    user_id: int
    username: str
    full_name: str | None = None
    team_id: int | None = None
    team_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    accuracy_m: float | None = None
    last_seen: dt.datetime | None = None
    is_stale: bool  # no ping in the last STALE_AFTER_MINUTES — probably not actively tracking anymore
    today: TeamTodayProgress


# ---------- Choice lists (for the frontend to render dropdowns from a single source of truth) ----------
class ChoiceLists(BaseModel):
    ohl: list[str] = OHL_CHOICES
    phase: list[str] = PHASE_CHOICES
    string: list[str] = STRING_CHOICES
    direction: list[str] = DIRECTION_CHOICES
    tower_proximity: list[str] = TOWER_PROXIMITY_CHOICES
    image_type: list[str] = IMAGE_TYPE_CHOICES
    screening_result: list[str] = SCREENING_RESULT_CHOICES
    hotspot: list[str] = HOTSPOT_CHOICES
    severity: list[str] = SEVERITY_CHOICES
    confidence: list[str] = CONFIDENCE_CHOICES
    evidence_status: list[str] = EVIDENCE_STATUS_CHOICES
    insulator_type: list[str] = INSULATOR_TYPE_CHOICES
    mount_type: list[str] = MOUNT_TYPE_CHOICES
    string_count: list[str] = STRING_COUNT_CHOICES
    pollution_condition: list[str] = POLLUTION_CONDITION_CHOICES
    thermal_indication: list[str] = THERMAL_INDICATION_CHOICES
    visual_indication: list[str] = VISUAL_INDICATION_CHOICES
    overall_condition: list[str] = OVERALL_CONDITION_CHOICES


# ---------- Field execution plan (the OETC-style mobilization plan report — see
# services/field_execution_plan.py for how these drive the generated .docx) ----------
class FieldExecutionPlanRequest(BaseModel):
    client_name: str = Field(min_length=1, max_length=300, description="Full client name, e.g. the utility company")
    client_short: str = Field(min_length=1, max_length=60, description="Short code used inline, e.g. 'OETC'")
    reference_no: str = Field(min_length=1, max_length=120, description="The client's reference letter number")
    reference_date: str = Field(min_length=1, max_length=40, description="Reference letter date, shown as typed")
    prepared_by: str = Field(min_length=1, max_length=200, description="Preparing company name")
    period_label: str = Field(min_length=1, max_length=60, description="Target execution period, e.g. 'September 2026'")
    voltage_label: str = Field(min_length=1, max_length=40, description="Voltage class label, e.g. '132 كيلوفولت'")
    region_label: str = Field(min_length=1, max_length=120, description="Region/governorate label, e.g. 'محافظة ظفار'")
    area: str | None = Field(default=None, description="Restrict included towers to this Tower.area; omit for all active towers")
    team_ids: list[int] | None = Field(default=None, description="Which teams to include; omit for all active teams")
    capacity_per_team_per_day: int = Field(default=15, ge=1, le=200, description="Assumed towers/day a 3-person crew can cover")


# ---------- OETC-format official report (the customer's exact "Transmission Line Insulator Thermal
# Inspection Report" template — see services/oetc_report.py) — one team's line campaign over a date
# range, rendered straight into that template. Everything here is either not derivable from the raw
# field data (report number, sign-off) or is the engineer's own judgment call at report time. ----------
class LineInspectionReportRequest(BaseModel):
    # "Report by team" gives team_id alone (None tower_id = that team's whole campaign, i.e. "full
    # towers"). "Report by tower" gives tower_id alone and leaves team_id unset — the router resolves
    # the team from the tower's current assignment, so the UI only needs one dropdown, not two, and
    # never has to guess which team a tower belongs to. Giving both scopes to one tower within one
    # named team (the team-page shortcut, where the team is already known from context).
    team_id: int | None = None
    tower_id: int | None = None
    start_date: dt.date
    end_date: dt.date
    report_number: str = Field(min_length=1, max_length=80)
    overall_condition: str | None = None
    probable_cause: str | None = None
    corrective_action: str | None = None
    additional_comments: str | None = None
    prepared_by: str | None = None
    reviewed_by: str | None = None
    approved_by: str | None = None
    approval_date: dt.date | None = None

    @model_validator(mode="after")
    def check_team_or_tower(self):
        if self.team_id is None and self.tower_id is None:
            raise ValueError("Provide team_id, tower_id, or both")
        return self

    @field_validator("overall_condition")
    @classmethod
    def check_overall_condition(cls, v):
        if v is not None and v not in OVERALL_CONDITION_CHOICES:
            raise ValueError(f"overall_condition must be one of {OVERALL_CONDITION_CHOICES}")
        return v


# ---------- Grouped OETC reports (services/oetc_grouped_report.py) — the same official template as
# above, but covering every team working one area (OetcAreaReportRequest) or every team in every
# area at once (OetcConsolidatedReportRequest). Each team's own section is the exact same unmodified
# report as LineInspectionReportRequest produces; these just decide which sections go in one file,
# in Area → Team → Mission order, under one shared sign-off. `report_number` is the base — each
# team's section gets its own suffixed number derived from it, so it stays traceable per team in the
# report history. ----------
class OetcAreaReportRequest(BaseModel):
    area: str
    start_date: dt.date
    end_date: dt.date
    report_number: str = Field(min_length=1, max_length=80)
    overall_condition: str | None = None
    probable_cause: str | None = None
    corrective_action: str | None = None
    additional_comments: str | None = None
    prepared_by: str | None = None
    reviewed_by: str | None = None
    approved_by: str | None = None
    approval_date: dt.date | None = None

    @field_validator("overall_condition")
    @classmethod
    def check_overall_condition(cls, v):
        if v is not None and v not in OVERALL_CONDITION_CHOICES:
            raise ValueError(f"overall_condition must be one of {OVERALL_CONDITION_CHOICES}")
        return v


class OetcConsolidatedReportRequest(BaseModel):
    start_date: dt.date
    end_date: dt.date
    report_number: str = Field(min_length=1, max_length=80)
    overall_condition: str | None = None
    probable_cause: str | None = None
    corrective_action: str | None = None
    additional_comments: str | None = None
    prepared_by: str | None = None
    reviewed_by: str | None = None
    approved_by: str | None = None
    approval_date: dt.date | None = None

    @field_validator("overall_condition")
    @classmethod
    def check_overall_condition(cls, v):
        if v is not None and v not in OVERALL_CONDITION_CHOICES:
            raise ValueError(f"overall_condition must be one of {OVERALL_CONDITION_CHOICES}")
        return v


class LineInspectionReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    team_id: int
    team_name: str | None = None
    tower_id: int | None = None
    tower_name: str | None = None
    start_date: dt.date
    end_date: dt.date
    report_number: str
    overall_condition: str | None
    probable_cause: str | None = None
    corrective_action: str | None = None
    additional_comments: str | None = None
    prepared_by: str | None
    reviewed_by: str | None
    approved_by: str | None
    approval_date: dt.date | None
    created_at: dt.datetime
    line_sector: str | None = None
    report_type: str | None = None
    has_file: bool = False
    image_count: int = 0


class LineInspectionReportUpdate(BaseModel):
    """Editing an already-generated report never touches the underlying readings/images — only the
    sign-off/assessment fields that exist solely at report time (see models.LineInspectionReport).
    Who may call this: an admin (with the usual generate_reports permission), or a client account
    with User.can_edit_reports — see routers/reports.py's update_oetc_line_report."""

    overall_condition: str | None = None
    probable_cause: str | None = None
    corrective_action: str | None = None
    additional_comments: str | None = None
    prepared_by: str | None = None
    reviewed_by: str | None = None
    approved_by: str | None = None
    approval_date: dt.date | None = None

    @field_validator("overall_condition")
    @classmethod
    def check_overall_condition(cls, v):
        if v is not None and v not in OVERALL_CONDITION_CHOICES:
            raise ValueError(f"overall_condition must be one of {OVERALL_CONDITION_CHOICES}")
        return v


class ReportImageOut(BaseModel):
    """One image linked to a generated report (see models.ReportImage) — enough context for the
    client portal's per-report image archive to group/label/link back to the field data without a
    second round trip."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    position_id: int
    image_id: int
    image_type: str
    position_code: str | None = None
    tower_id: int
    tower_code: str
    area: str | None = None
    capture_date: dt.date | None = None
    capture_time: dt.time | None = None


class OetcReportPreview(BaseModel):
    """A cheap, read-only summary of what an official report would include for a given scope/date
    range — no rendering, nothing persisted. Lets the report form show "this will include: 3
    towers, 14 positions, 2 hotspots" the moment a scope and date range are picked, before the
    admin has filled in the rest of the form (report number, sign-off, etc.)."""

    ok: bool
    team_count: int
    tower_count: int
    visit_count: int
    position_count: int
    hotspot_count: int
    message: str | None = None


class TeamArchiveImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    team_id: int
    team_name: str | None = None
    capture_date: dt.date
    latitude: float | None = None
    longitude: float | None = None
    caption: str | None = None
    content_type: str | None = None
    original_filename: str | None = None
    file_size: int | None = None
    has_thumbnail: bool = False
    uploaded_by: int | None = None
    uploaded_by_name: str | None = None
    uploaded_at: dt.datetime


class HelpChatTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class HelpChatRequest(BaseModel):
    message: str
    # Prior turns of this conversation, oldest first — the API is stateless, so the frontend
    # resends them each time (see components/HelpChatWidget.tsx).
    history: list[HelpChatTurn] = []
    # "local" (default): the guide + this app's own live-data/knowledge-base tools, no internet.
    # "internet": only Anthropic's server-executed web_search tool, no local tools at all.
    # "both": everything. Picked per message via a 3-way control in the chat UI (see
    # components/HelpChatWidget.tsx) — never left to default to anything but "local".
    search_mode: Literal["local", "internet", "both"] = "local"


class HelpChatResponse(BaseModel):
    reply: str


class BrandingOut(BaseModel):
    app_title: str | None = None
    app_version: str | None = None
    splash_header: str | None = None
    splash_subtitle: str | None = None
    # Absolute API paths (e.g. "/api/settings/branding/logo/oetc") when a logo has been uploaded,
    # else None — the frontend falls back to its own bundled placeholder in that case.
    oetc_logo_url: str | None = None
    sky_green_line_logo_url: str | None = None
    # Display size (px) on the splash screen — None means "use the built-in default size".
    oetc_logo_width: int | None = None
    oetc_logo_height: int | None = None
    sky_green_line_logo_width: int | None = None
    sky_green_line_logo_height: int | None = None
    # Where the main logo sits on the banner (% from top-left) — None means the built-in corner spot.
    oetc_logo_pos_x: float | None = None
    oetc_logo_pos_y: float | None = None
    # Same idea for the Sky Green Line logo and the name/version text — None means "not pinned to
    # the banner", so each falls back to its own spot in the row below it instead.
    sky_green_line_logo_pos_x: float | None = None
    sky_green_line_logo_pos_y: float | None = None
    app_title_pos_x: float | None = None
    app_title_pos_y: float | None = None
    # Same idea, but no placeholder fallback — a banner photo across the top of the splash is purely
    # optional, so None just means "don't show one".
    hero_image_url: str | None = None
    # Only true once an admin has explicitly saved settings — lets the splash screen keep showing
    # its own sensible defaults (rather than blanks) until then.
    configured: bool = False
    # Organization identity shown on generated PDF reports (see services/reports.py) — separate
    # from the splash-only logo/title fields above.
    org_logo_url: str | None = None
    org_name_en: str | None = None
    org_name_ar: str | None = None
    org_footer_text: str | None = None
    org_report_footer: str | None = None
    org_contact: str | None = None
    # A full-bleed photo behind the login form — None falls back to the built-in gradient.
    login_background_url: str | None = None


class PublicBrandingOut(BaseModel):
    """The subset of BrandingOut safe to expose with no login — see app_settings.get_public_branding."""

    org_logo_url: str | None = None
    org_name_en: str | None = None
    login_background_url: str | None = None


class BrandingUpdate(BaseModel):
    app_title: str | None = None
    splash_header: str | None = None
    splash_subtitle: str | None = None


class KnowledgeDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    description: str | None = None
    team_id: int | None = None
    team_name: str | None = None
    original_filename: str | None = None
    content_type: str | None = None
    file_size: int | None = None
    has_text: bool = False
    is_composed: bool = False
    has_voice: bool = False
    voice_duration_seconds: float | None = None
    uploaded_by: int | None = None
    uploaded_by_name: str | None = None
    uploaded_at: dt.datetime


class KnowledgeDocumentDetail(KnowledgeDocumentOut):
    extracted_text: str | None = None
    body_html: str | None = None


class KnowledgeDocumentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    team_id: int | None = None
    # Only honored when the document is_composed — see routers/knowledge_base.py's update_document.
    # body_html (from the rich-text editor) takes priority over the older plain-text body_text.
    body_text: str | None = None
    body_html: str | None = None
    save_as: str | None = None
