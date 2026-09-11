// The admin-managed catalog behind Tower.area — see backend models.Area / routers/areas.py.
export interface Area {
  id: number;
  name: string;
  notes: string | null;
  tower_count: number;
  created_at: string;
  updated_at: string;
}

export interface Tower {
  id: number;
  tower_id: string;
  voltage: string | null;
  tower_type: string | null;
  area: string | null;
  line_sector: string | null;
  // Which team is responsible for inspecting this tower — the admin-set assignment that drives a
  // team's Job Map and progress measurement. Separate from line_sector (just a descriptive label).
  assigned_team_id: number | null;
  assigned_team_name: string | null;
  location_name: string | null;
  height_m: number | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  photo_path: string | null;
  photo_thumbnail_path: string | null;
  photo_original_filename: string | null;
  photo_uploaded_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TowerWithStats extends Tower {
  latest_visit_status: string | null;
  latest_visit_date: string | null;
  visit_count: number;
  open_hotspots: number;
}

export interface ImageRow {
  id: number;
  position_id: number;
  image_type: 'TH Full' | 'TH Close' | 'RGB Full' | 'RGB Close';
  image_code: string | null;
  sequence: number;
  capture_date: string | null;
  capture_time: string | null;
  latitude: number | null;
  longitude: number | null;
  evidence_status: 'NOT REQUIRED' | 'PENDING CAPTURE' | 'COMPLETE' | 'RECAPTURE REQUIRED';
  file_path: string | null;
  thumbnail_path: string | null;
  original_filename: string | null;
  file_size: number | null;
  uploaded_at: string | null;
  annotated_path: string | null;
  annotated_thumbnail_path: string | null;
  annotated_uploaded_at: string | null;
}

export interface Position {
  id: number;
  visit_id: number;
  ohl: string;
  phase: string;
  string: string;
  direction: string | null;
  tower_proximity: string | null;
  installed: boolean;
  screening_result: string;
  hotspot: string | null;
  tmax_c: number | null;
  tref_c: number | null;
  severity: string | null;
  confidence: string | null;
  inspector_notes: string | null;
  // ---------- OETC official-report fields — see backend models.Position for what each drives. ----------
  manufacturer: string | null;
  year_installed: number | null;
  insulator_type: string | null;
  mount_type: string | null;
  gs_side: string | null;
  string_count: string | null;
  pollution_condition: string | null;
  thermal_indication: string | null;
  visual_indications: string | null; // comma-joined subset of ChoiceLists.visual_indication
  position_code: string | null;
  images: ImageRow[];
}

export interface VisitRollup {
  possible_positions: number;
  installed: number;
  screened: number;
  hotspots: number;
  inconclusive: number;
  images_pending: number;
  completion_pct: number;
  visit_status: string;
}

export interface Visit {
  id: number;
  tower_id: number;
  inspection_date: string | null;
  inspector_name: string | null;
  latitude: number | null;
  longitude: number | null;
  weather_wind: string | null;
  electrical_load: string | null;
  camera_drone: string | null;
  thermal_mode: string | null;
  emissivity: number | null;
  reflected_temp: number | null;
  permit_job_no: string | null;
  // ---------- Equipment/environment fields for the OETC report template, captured once per visit. ----------
  camera_serial_no: string | null;
  calibration_cert_no: string | null;
  calibration_due_date: string | null;
  distance_to_target_m: number | null;
  ambient_temp_c: number | null;
  humidity_pct: number | null;
  status: string;
  // A visit IS a team's mission when these are set — see backend models.Visit for why there's no
  // separate "mission" record.
  team_id: number | null;
  mission_seq: number | null;
  team_name: string | null;
  // Which team_member this mission is assigned to — a team_member's whole access is scoped to
  // just the visits assigned to them (see backend deps.check_visit_team_access).
  assigned_member_id: number | null;
  assigned_member_name: string | null;
  start_time: string | null;
  end_time: string | null;
  mission_status: string;
  photo_count: number;
  created_at: string;
  updated_at: string;
  tower?: Tower | null;
  rollup?: VisitRollup | null;
}

export interface VisitDetail extends Visit {
  positions: Position[];
}

export interface DashboardTowerRow {
  tower: Tower;
  latest_visit: Visit | null;
  rollup: VisitRollup | null;
}

export interface DashboardSummary {
  tower_count: number;
  visit_count: number;
  total_hotspots: number;
  total_images_pending: number;
  rows: DashboardTowerRow[];
}

export interface ChoiceLists {
  ohl: string[];
  phase: string[];
  string: string[];
  direction: string[];
  tower_proximity: string[];
  image_type: string[];
  screening_result: string[];
  hotspot: string[];
  severity: string[];
  confidence: string[];
  evidence_status: string[];
  insulator_type: string[];
  mount_type: string[];
  string_count: string[];
  pollution_condition: string[];
  thermal_indication: string[];
  visual_indication: string[];
  overall_condition: string[];
}

// ---------- OETC official report (a team's line campaign, rendered into the customer's exact
// template) — see backend services/oetc_report.py. ----------
export interface LineInspectionReportRequest {
  team_id: number;
  start_date: string;
  end_date: string;
  report_number: string;
  overall_condition?: string | null;
  probable_cause?: string | null;
  corrective_action?: string | null;
  additional_comments?: string | null;
  prepared_by?: string | null;
  reviewed_by?: string | null;
  approved_by?: string | null;
  approval_date?: string | null;
}

// Same official template, grouped across every team working one area (OetcAreaReportRequest) or
// every team in every area at once (OetcConsolidatedReportRequest) — see
// backend services/oetc_grouped_report.py. Each team's own section is unchanged; these just decide
// which sections go into the one file, in Area → Team → Mission order.
export interface OetcAreaReportRequest {
  area: string;
  start_date: string;
  end_date: string;
  report_number: string;
  overall_condition?: string | null;
  probable_cause?: string | null;
  corrective_action?: string | null;
  additional_comments?: string | null;
  prepared_by?: string | null;
  reviewed_by?: string | null;
  approved_by?: string | null;
  approval_date?: string | null;
}

export interface OetcConsolidatedReportRequest {
  start_date: string;
  end_date: string;
  report_number: string;
  overall_condition?: string | null;
  probable_cause?: string | null;
  corrective_action?: string | null;
  additional_comments?: string | null;
  prepared_by?: string | null;
  reviewed_by?: string | null;
  approved_by?: string | null;
  approval_date?: string | null;
}

export interface LineInspectionReportOut {
  id: number;
  team_id: number;
  team_name: string | null;
  start_date: string;
  end_date: string;
  report_number: string;
  overall_condition: string | null;
  prepared_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  approval_date: string | null;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user_id: number;
  role: string;
  username: string;
  full_name: string | null;
  team_id: number | null;
}

export interface ReportTemplate {
  id: number;
  kind: 'docx' | 'pdf';
  original_filename: string;
  uploaded_at: string;
}

export interface ReportTemplatesActive {
  docx: ReportTemplate | null;
  pdf: ReportTemplate | null;
}

export interface TrailPoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
}

export interface TrackingMission {
  id: number | null;
  kind: 'mission' | 'night' | string;
  label: string;
  field_date: string;
  started_at: string;
  ended_at: string | null;
  is_current: boolean;
  ping_count: number;
}

export interface UserTrail {
  user_id: number;
  username: string;
  full_name: string | null;
  team_name?: string | null;
  points: TrailPoint[];
}

export interface TowerStay {
  tower_pk: number;
  tower_id: string;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  arrived_at: string;
  departed_at: string;
  minutes: number;
  visit_id: number | null;
  visit_status: string | null;
  travel_from_prev_minutes?: number | null;
  travel_from_prev_km?: number | null;
}

export interface TeamProgressLogin {
  user_id: number;
  username: string;
  full_name: string | null;
}

export interface TeamProgressDelta {
  field_date: string;
  minutes_tracked_delta: number;
  distance_km_delta: number;
  towers_delta: number;
  avg_minutes_per_tower_delta: number;
}

export interface TeamProgress {
  team_id: number | null;
  team_name: string;
  field_date: string;
  started_at: string;
  ended_at: string;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number;
  end_longitude: number;
  minutes_tracked: number;
  distance_km: number;
  towers_visited: number;
  dwell_minutes: number;
  travel_minutes: number;
  avg_minutes_per_tower: number;
  avg_travel_minutes: number;
  ping_count: number;
  logins: TeamProgressLogin[];
  stays: TowerStay[];
  path: TrailPoint[];
  vs_previous: TeamProgressDelta | null;
}

export interface MovementDayReport {
  user_id: number;
  username: string;
  full_name: string | null;
  team_id: number | null;
  team_name: string | null;
  first_seen: string;
  last_seen: string;
  minutes_tracked: number;
  distance_km: number;
  ping_count: number;
  path: TrailPoint[];
  stays: TowerStay[];
}

export interface TeamTodayProgress {
  towers_visited: number;
  visits_touched: number;
  screened: number;
  hotspots: number;
}

export interface LiveTeamMember {
  user_id: number;
  username: string;
  full_name: string | null;
  team_id: number | null;
  team_name: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  last_seen: string | null;
  is_stale: boolean;
  today: TeamTodayProgress;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  mobile: string | null;
  address: string | null;
  notes: string | null;
  job_type: string | null;
  role: string;
  is_active: boolean;
  team_id: number | null;
}

export interface TeamMember {
  id: number;
  team_id: number;
  name: string;
  phone: string | null;
  national_id: string | null;
  is_leader: boolean;
  role_title: string | null;
  notes: string | null;
}

export interface TeamDailyLogFile {
  id: number;
  original_filename: string | null;
  content_type: string | null;
  file_size: number | null;
  is_image: boolean;
  is_pdf: boolean;
}

export interface TeamDailyLog {
  id: number;
  team_id: number;
  log_date: string;
  note: string;
  has_audio: boolean;
  transcribed: boolean;
  audio_content_type: string | null;
  duration_seconds: number | null;
  attachments: TeamDailyLogFile[];
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

export interface Team {
  id: number;
  name: string;
  leader_name: string | null;
  leader_phone: string | null;
  mission: string | null;
  mission_from: string | null;
  mission_to: string | null;
  primary_sector: string | null;
  daily_target: number | null;
  leader_user_id: number | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  members: TeamMember[];
  linked_user_count: number;
  // How many missions (Visits) this team has run — deleting the team destroys all of them (and
  // every login linked to it). See backend teams.py's delete_team.
  mission_count: number;
}

// The team/day/tower/position/image hierarchy behind the "Team activity" master report
// (Reports page) — see backend services/team_activity_report.py for how this is built.
export interface TeamActivityImage {
  id: number;
  image_type: string;
  image_code: string | null;
  sequence: number;
  capture_date: string | null;
  capture_time: string | null;
  evidence_status: string;
  annotated: boolean;
  uploaded_at: string | null;
}

export interface TeamActivityPosition {
  id: number;
  ohl: string;
  phase: string;
  string: string;
  direction: string | null;
  tower_proximity: string | null;
  position_code: string | null;
  screening_result: string;
  hotspot: string | null;
  images: TeamActivityImage[];
}

export interface TeamActivityTower {
  visit_id: number;
  tower_id: number;
  tower_code: string;
  area: string | null;
  mission_seq: number | null;
  mission_status: string;
  inspector_name: string | null;
  positions: TeamActivityPosition[];
}

export interface TeamActivityDay {
  date: string;
  towers: TeamActivityTower[];
}

export interface TeamActivityTeam {
  team_id: number;
  team_name: string;
  days: TeamActivityDay[];
}

// Inputs for the "Field execution plan" mobilization/scheduling report (Reports page) — see backend
// services/field_execution_plan.py for what each field drives.
export interface FieldExecutionPlanRequest {
  client_name: string;
  client_short: string;
  reference_no: string;
  reference_date: string;
  prepared_by: string;
  period_label: string;
  voltage_label: string;
  region_label: string;
  area?: string;
  team_ids?: number[];
  capacity_per_team_per_day: number;
}

// The team's whole assigned scope of work — every tower in its sector, done vs. pending — not
// just the towers it has actually visited so far (contrast with the missions list). See backend
// routers/teams.py's team_job_map.
export interface TeamJobMapTower {
  id: number;
  tower_id: string;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  status: 'completed' | 'in_progress' | 'pending';
  visit_id: number | null;
}

export interface OutingPlanTower {
  id: number;
  tower_id: string;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  sort_order: number;
}

export interface OutingPlan {
  team_id: number;
  field_date: string;
  tower_ids: number[];
  towers: OutingPlanTower[];
  notes: string | null;
}

export interface TeamJobMap {
  sector: string | null;
  total: number;
  completed: number;
  in_progress: number;
  pending: number;
  towers: TeamJobMapTower[];
}

export interface NextTowerStop {
  rank: number;
  id: number;
  tower_id: string;
  area: string | null;
  latitude: number;
  longitude: number;
  status: string;
  visit_id: number | null;
  travel_km: number;
  travel_minutes: number;
  dwell_minutes: number;
  cumulative_minutes: number;
  fits_tonight: boolean;
  reason: string;
  claim_id: number | null;
  claim_status: string | null;
  claimed_by_id: number | null;
  claimed_by_name: string | null;
  mine: boolean;
  skip_reason: string | null;
}

export interface NightClaimCrewMember {
  user_id: number;
  username: string;
  full_name: string | null;
  role: string;
}

export type NightClaimStatus = 'claimed' | 'en_route' | 'on_site' | 'done' | 'skipped';

export interface NightClaim {
  id: number;
  team_id: number;
  field_date: string;
  tower_id: number;
  tower_code: string | null;
  assigned_user_id: number;
  assigned_user_name: string | null;
  status: NightClaimStatus;
  skip_reason: string | null;
  visit_id: number | null;
  claimed_at: string;
  arrived_at: string | null;
  completed_at: string | null;
}

export type ChannelKind = 'note' | 'dispatch' | 'access' | 'weather' | 'skip' | 'hotspot' | 'help';

export interface ChannelMessage {
  id: number;
  team_id: number;
  team_name: string | null;
  field_date: string;
  kind: ChannelKind;
  body: string;
  tower_id: number | null;
  tower_code: string | null;
  visit_id: number | null;
  latitude: number | null;
  longitude: number | null;
  has_photo: boolean;
  has_audio: boolean;
  duration_seconds: number | null;
  created_by: number | null;
  author_name: string | null;
  author_role: string | null;
  created_at: string;
}

export interface NextTowersPlan {
  team_id: number;
  team_name: string;
  field_date: string;
  origin_latitude: number | null;
  origin_longitude: number | null;
  origin_source: string;
  origin_label: string;
  minutes_left: number;
  still_night: boolean;
  daily_target: number | null;
  towers_done_tonight: number;
  behind_by: number | null;
  remaining_assigned: number;
  in_progress: number;
  pending: number;
  completed: number;
  skipped_no_gps: number;
  can_fit_tonight: number;
  dwell_minutes: number;
  headline: string;
  stops: NextTowerStop[];
  crew: NightClaimCrewMember[];
}

export interface VisitPhoto {
  id: number;
  visit_id: number;
  position_id: number | null;
  position_code: string | null;
  original_filename: string | null;
  file_size: number | null;
  caption: string | null;
  latitude: number | null;
  longitude: number | null;
  captured_at: string | null;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface TeamDayProgress {
  log_date: string;
  towers_visited: number;
  visits_touched: number;
  screened: number;
  hotspots: number;
  images_captured: number;
  first_seen: string | null;
  last_seen: string | null;
  notes: TeamDailyLog[];
}
