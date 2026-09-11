import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Menu,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBackRounded';
import AddIcon from '@mui/icons-material/AddRounded';
import LockOpenIcon from '@mui/icons-material/LockOpenRounded';
import DeleteIcon from '@mui/icons-material/DeleteRounded';
import EditIcon from '@mui/icons-material/EditRounded';
import MoreVertIcon from '@mui/icons-material/MoreVertRounded';
import PersonAddIcon from '@mui/icons-material/PersonAddRounded';
import LinkIcon from '@mui/icons-material/LinkRounded';
import LinkOffIcon from '@mui/icons-material/LinkOffRounded';
import CellTowerIcon from '@mui/icons-material/CellTowerRounded';
import FactCheckIcon from '@mui/icons-material/FactCheckRounded';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import ScheduleIcon from '@mui/icons-material/ScheduleRounded';
import PhotoCameraIcon from '@mui/icons-material/PhotoCameraRounded';
import PlaceIcon from '@mui/icons-material/PlaceRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreenRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import DirectionsIcon from '@mui/icons-material/DirectionsRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import RouteIcon from '@mui/icons-material/RouteRounded';
import TimerIcon from '@mui/icons-material/TimerRounded';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalkRounded';
import SubtitlesIcon from '@mui/icons-material/SubtitlesRounded';
import AttachFileIcon from '@mui/icons-material/AttachFileRounded';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdfRounded';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFileRounded';
import {
  useAddTeamNote,
  useAddTeamNoteFiles,
  useDeleteTeamNoteFile,
  useRenameTeamNoteFile,
  useReplaceTeamNoteFile,
  useAddTeamVoiceNote,
  useTranscribeTeamNote,
  useUpdateTeamNote,
  useChoiceLists,
  useClaimTowerForTeam,
  useCreateTeamMission,
  useCreateUser,
  useDeleteTeamNote,
  useDeleteUser,
  useDeleteVisit,
  useGenerateOetcReport,
  useRemoveTeamMember,
  useTeam,
  useShiftInfo,
  useTeamLive,
  useTeamTrails,
  useTeamFieldHistory,
  useTeamFieldTrack,
  useOutingPlan,
  useTeamJobMap,
  useTeamMissions,
  useClaimTower,
  useTeamNextTowers,
  useUpdateClaim,
  useTeamProgress,
  useReleaseTower,
  useTowers,
  useUpdateTeam,
  useUpdateUser,
  useUsers,
  useUpdateVisit,
} from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { mediaUrl } from '../api/client';
import { TILE_LAYERS, type MapLayer } from '../components/MapPicker';
import { VoiceNoteControls, VoiceNotePlayer } from '../components/VoiceNoteControls';
import { splitTrailSegments } from '../utils/gpsTrail';
import { useOffline } from '../offline/OfflineProvider';
import { NextTowersCard } from '../components/NextTowersCard';
import { NightChannel } from '../components/NightChannel';
import { requestBrowserLocation, useTracking } from '../hooks/useFieldTracking';
import { TeamSiteMap } from '../components/TeamSiteMap';
import { OutingPlanCard } from '../components/OutingPlanCard';
import { ClaimTowerDialog } from '../components/ClaimTowerDialog';
import { KpiTile } from '../components/KpiTile';
import type { AdminUser, NextTowerStop, NightClaimStatus, TrackingMission } from '../api/types';

const MISSION_STATUS_COLORS: Record<string, 'default' | 'info' | 'success'> = {
  planned: 'default',
  in_progress: 'info',
  completed: 'success',
};

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'default'> = {
  active: 'success',
  paused: 'warning',
  completed: 'default',
};

// Suggested presets for a team_member's job_type — free text underneath, so a leader can still
// type something else if the crew has a role that doesn't fit these.
const JOB_TYPE_OPTIONS = ['Drone Operator', 'Photographer', 'Recorder / Data Logger', 'Data Entry', 'Analyst'];

const JOB_MAP_COLORS: Record<string, string> = {
  completed: '#2e7d32',
  in_progress: '#1976d2',
  pending: '#9e9e9e',
};
const JOB_MAP_LABELS: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  pending: 'Not started yet',
};

function dotIcon(color: string, focused = false) {
  if (focused) {
    // Highlighted pick: a red box around the dot, so a tower selected from the table is
    // unmistakable on the map (per user request — "a red box around it to show the location").
    return L.divIcon({
      className: '',
      html: `<div style="position:relative;width:38px;height:38px;">
        <div style="position:absolute;inset:0;border:3px solid #d32f2f;border-radius:4px;box-shadow:0 0 0 2px rgba(255,255,255,0.9),0 2px 6px rgba(0,0,0,0.35);"></div>
        <div style="position:absolute;top:50%;left:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:${color};border:2px solid white;"></div>
      </div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });
  }
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.35)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function myLocationIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:22px;height:22px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(25,118,210,0.25);"></div>
      <div style="position:absolute;top:50%;left:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#1976d2;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.35);"></div>
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function mergeFiles(existing: File[], incoming: File[]): File[] {
  const seen = new Set(existing.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
  return [...existing, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}:${f.lastModified}`))];
}

function formatBytes(n: number | null | undefined): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isoMs(iso: string): number {
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
}

function missionSelectKey(m: TrackingMission): string {
  if (m.kind === 'night' || m.id == null) return `night:${m.field_date}`;
  return `mission:${m.id}`;
}

function TrackMapBridge({ mapRef }: { mapRef: MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

function FitTrack({ positions, resetKey }: { positions: [number, number][]; resetKey: string }) {
  const map = useMap();
  const lastKey = useRef('');
  useEffect(() => {
    if (positions.length === 0) return;
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    if (positions.length === 1) map.setView(positions[0], 14);
    else map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  return null;
}

function planRankIcon(n: number, color: string) {
  return L.divIcon({
    className: 'team-live-label',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};color:#fff;font:800 12px/26px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function towerSquareIcon(label: string) {
  const safe = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return L.divIcon({
    className: 'team-live-label',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-2px)">
      <div style="width:18px;height:18px;background:#d32f2f;border:2px solid #fff;box-shadow:0 0 0 2px #d32f2f"></div>
      <div style="margin-top:4px;padding:2px 7px;border-radius:4px;background:#c62828;color:#fff;font:700 11px/15px system-ui,sans-serif;white-space:nowrap">${safe}</div>
    </div>`,
    iconSize: [180, 46],
    iconAnchor: [90, 9],
  });
}

export function TeamDetailPage() {
  const { teamId } = useParams();
  const id = Number(teamId);
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { lastLatitude, lastLongitude } = useTracking();
  const { data: team, isLoading, isError, error: teamError } = useTeam(id);
  const updateTeam = useUpdateTeam();
  const removeMember = useRemoveTeamMember(id);
  const addNote = useAddTeamNote(id);
  const addNoteFiles = useAddTeamNoteFiles(id);
  const deleteNoteFile = useDeleteTeamNoteFile(id);
  const renameNoteFile = useRenameTeamNoteFile(id);
  const replaceNoteFile = useReplaceTeamNoteFile(id);
  const replaceFileInput = useRef<HTMLInputElement | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<{ noteId: number; fileId: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ noteId: number; fileId: number; name: string } | null>(null);
  const addVoiceNote = useAddTeamVoiceNote(id);
  const photoInputByDate = useRef<Record<string, HTMLInputElement | null>>({});
  const docInputByDate = useRef<Record<string, HTMLInputElement | null>>({});
  const morePhotoInput = useRef<HTMLInputElement | null>(null);
  const moreDocInput = useRef<HTMLInputElement | null>(null);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [addMoreNoteId, setAddMoreNoteId] = useState<number | null>(null);
  const transcribeNote = useTranscribeTeamNote(id);
  const updateNote = useUpdateTeamNote(id);
  const deleteNote = useDeleteTeamNote(id);
  const [transcriptDraft, setTranscriptDraft] = useState<Record<number, string>>({});
  const [convertError, setConvertError] = useState<Record<number, string>>({});
  const updateUserMut = useUpdateUser();
  const createUserMut = useCreateUser();
  const { data: liveMembers } = useTeamLive(id);
  const { data: teamTrails } = useTeamTrails(id);
  const { data: missions } = useTeamMissions(id);
  const { data: jobMap } = useTeamJobMap(id);
  const [deviceHere, setDeviceHere] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    requestBrowserLocation((lat, lng) => setDeviceHere({ lat, lng }), undefined, false);
  }, []);
  const { data: nextPlan, isLoading: nextPlanLoading } = useTeamNextTowers(
    Number.isFinite(id) ? id : undefined,
    deviceHere?.lat,
    deviceHere?.lng,
  );
  const createMission = useCreateTeamMission(id);
  const claimTower = useClaimTower(id);
  const updateClaim = useUpdateClaim(id);
  const canAssignClaims =
    currentUser?.role === 'admin' || currentUser?.role === 'reviewer' || currentUser?.role === 'team_leader';
  const updateVisit = useUpdateVisit();
  const deleteVisit = useDeleteVisit();
  const { data: towers } = useTowers({ include_inactive: true, limit: 5000 });
  const claimForTeam = useClaimTowerForTeam();
  const releaseTower = useReleaseTower();
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const freeTowers = (towers || []).filter((t) => t.is_active && t.assigned_team_id == null);
  const { data: lists } = useChoiceLists();
  const generateOetcReport = useGenerateOetcReport();

  const isAdmin = currentUser?.role === 'admin';
  const isTeamLeader = currentUser?.role === 'team_leader';
  const isTeamMember = currentUser?.role === 'team_member';
  const canManage = isAdmin || isTeamLeader;
  const canRecord = canManage || isTeamMember;
  const canLogNotes = canRecord;
  // The users-listing endpoint is admin-or-team_leader on the backend (a leader only ever gets
  // their own team's accounts back, never another team's) — team_member accounts get nothing here.
  const { data: enabledUsers } = useUsers(isAdmin || isTeamLeader);
  const { data: shift } = useShiftInfo();
  const { data: outingPlan } = useOutingPlan(Number.isFinite(id) ? id : undefined, shift?.field_date);
  const { data: fieldHistory } = useTeamFieldHistory(Number.isFinite(id) ? id : undefined);
  const [trackKey, setTrackKey] = useState('');
  const [trackStayIdx, setTrackStayIdx] = useState<number | null>(null);
  const trackMapRef = useRef<L.Map | null>(null);
  const defaultNightKey = shift?.field_date ? `night:${shift.field_date}` : '';
  const effectiveTrackKey = trackKey || defaultNightKey;
  const pickedHistory = (fieldHistory || []).find((m) => missionSelectKey(m) === effectiveTrackKey) || null;
  const trackDate = pickedHistory?.field_date || shift?.field_date || '';
  const trackMissionId = effectiveTrackKey.startsWith('mission:') ? Number(effectiveTrackKey.slice(8)) : undefined;
  const { data: fieldTracks } = useTeamFieldTrack(
    Number.isFinite(id) ? id : undefined,
    trackMissionId ? undefined : trackDate || undefined,
    trackMissionId,
  );
  const recap = fieldTracks?.[0] || null;
  const trackStay = recap && trackStayIdx != null ? recap.stays[trackStayIdx] ?? null : null;
  const trackNextStay = recap && trackStayIdx != null ? recap.stays[trackStayIdx + 1] : undefined;

  const today = new Date().toISOString().slice(0, 10);
  const defaultStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const [rangeStart, setRangeStart] = useState(defaultStart);
  const [rangeEnd, setRangeEnd] = useState(today);
  const { data: progress, isLoading: progressLoading } = useTeamProgress(id, rangeStart, rangeEnd);
  const { items: outbox, previewUrl } = useOffline();
  const queuedNotesForDay = (logDate: string) =>
    outbox.filter(
      (i) =>
        (i.kind === 'team-note' || i.kind === 'team-voice' || i.kind === 'team-files') &&
        Number(i.path.teamId) === id &&
        String(i.json?.log_date || '') === logDate,
    );

  // ---------- Official OETC-format report — see services/oetc_report.py. One team's line campaign
  // over a date range, rendered straight into the customer's exact template. ----------
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportForm, setReportForm] = useState({
    start_date: rangeStart,
    end_date: rangeEnd,
    report_number: '',
    overall_condition: '',
    probable_cause: '',
    corrective_action: '',
    additional_comments: '',
    prepared_by: '',
    reviewed_by: '',
    approved_by: '',
    approval_date: today,
  });
  const openReportDialog = () => {
    setReportForm((f) => ({ ...f, start_date: rangeStart, end_date: rangeEnd }));
    setReportError(null);
    setReportDialogOpen(true);
  };
  const handleGenerateReport = () => {
    setReportError(null);
    generateOetcReport.mutate(
      {
        team_id: id,
        start_date: reportForm.start_date,
        end_date: reportForm.end_date,
        report_number: reportForm.report_number.trim(),
        overall_condition: reportForm.overall_condition || null,
        probable_cause: reportForm.probable_cause || null,
        corrective_action: reportForm.corrective_action || null,
        additional_comments: reportForm.additional_comments || null,
        prepared_by: reportForm.prepared_by || null,
        reviewed_by: reportForm.reviewed_by || null,
        approved_by: reportForm.approved_by || null,
        approval_date: reportForm.approval_date || null,
      },
      {
        onSuccess: () => setReportDialogOpen(false),
        onError: (err: unknown) => {
          const message =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not generate the report';
          setReportError(message);
        },
      },
    );
  };

  const [linkUserId, setLinkUserId] = useState<string>('');
  const [newLoginForm, setNewLoginForm] = useState({ username: '', password: '', full_name: '' });
  const [newLoginError, setNewLoginError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [missionForm, setMissionForm] = useState({
    tower_id: '',
    inspection_date: new Date().toISOString().slice(0, 10),
    start_time: '',
    end_time: '',
    assigned_member_id: '',
  });

  // ---------- Team member logins (job-classified field workers, created by this leader/admin) ----------
  const createMemberLogin = useCreateUser();
  const updateMemberLogin = useUpdateUser();
  const deleteMemberLogin = useDeleteUser();
  const [memberLoginForm, setMemberLoginForm] = useState({
    full_name: '',
    mobile: '',
    job_type: '',
    username: '',
    password: '',
    notes: '',
  });
  const [memberLoginError, setMemberLoginError] = useState<string | null>(null);

  // Clicking a tower in the Job map table flies the map to it and rings it in a red box, so the
  // field crew can find that exact tower's location at a glance.
  const [focusedJobMapTowerId, setFocusedJobMapTowerId] = useState<number | null>(null);
  const jobMapRef = useRef<L.Map | null>(null);
  // Job map's own enlarge + satellite toggle — same controls as TowersOverviewMap, but sized in vh
  // so "enlarge" actually reads as most of the screen, per user request.
  const [jobMapExpanded, setJobMapExpanded] = useState(false);
  const [jobMapLayer, setJobMapLayer] = useState<MapLayer>('street');
  // "Show path to this tower" — a one-shot geolocation fix (not the continuous background
  // tracking of useFieldTracking), then an actual road-following driving route (via OSRM's free
  // public routing API — no key needed) traced on the map itself, the way Google Maps draws a
  // route; if that service can't be reached, falls back to a straight line plus a Google Maps
  // hand-off link so the crew can still get turn-by-turn on their phone.
  const [routeOrigin, setRouteOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [routeTowerId, setRouteTowerId] = useState<number | null>(null);
  const [routingTowerId, setRoutingTowerId] = useState<number | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const [routeDriving, setRouteDriving] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [routeFetchingPath, setRouteFetchingPath] = useState(false);
  const [routePathFailed, setRoutePathFailed] = useState(false);

  // Per-row "⋮" menu for a team member's login, and the Edit dialog it opens into. Two separate
  // targets on purpose: the menu closes as soon as you pick an action, but the Edit dialog needs to
  // keep knowing who it's editing for its whole (much longer) lifetime.
  const [memberMenuAnchor, setMemberMenuAnchor] = useState<HTMLElement | null>(null);
  const [memberMenuTarget, setMemberMenuTarget] = useState<AdminUser | null>(null);
  const [editingMember, setEditingMember] = useState<AdminUser | null>(null);
  const [editMemberOpen, setEditMemberOpen] = useState(false);
  const [editMemberForm, setEditMemberForm] = useState({ full_name: '', mobile: '', job_type: '', notes: '', password: '' });
  const [editMemberError, setEditMemberError] = useState<string | null>(null);

  // Read-only, for the "Add mission" tower picker below and for what this page shows as "yours" —
  // actually assigning/unassigning towers is done from the Teams list's Add/Edit dialog now (which
  // locks out any tower already on another team); this page just reflects the current scope.
  const teamTowers = (towers || []).filter((t) => t.assigned_team_id === id);

  const openMemberEdit = (u: AdminUser) => {
    setMemberMenuAnchor(null);
    setMemberMenuTarget(null);
    setEditingMember(u);
    setEditMemberForm({ full_name: u.full_name || '', mobile: u.mobile || '', job_type: u.job_type || '', notes: u.notes || '', password: '' });
    setEditMemberError(null);
    setEditMemberOpen(true);
  };

  const handleSaveMemberEdit = () => {
    if (!editingMember) return;
    if (editMemberForm.password && editMemberForm.password.length < 6) {
      setEditMemberError('New password needs at least 6 characters.');
      return;
    }
    setEditMemberError(null);
    updateMemberLogin.mutate(
      {
        id: editingMember.id,
        payload: {
          full_name: editMemberForm.full_name.trim() || undefined,
          mobile: editMemberForm.mobile.trim() || undefined,
          job_type: editMemberForm.job_type.trim() || undefined,
          notes: editMemberForm.notes.trim() || undefined,
          ...(editMemberForm.password ? { password: editMemberForm.password } : {}),
        },
      },
      {
        onSuccess: () => setEditMemberOpen(false),
        onError: (err: unknown) => {
          const message =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not save changes';
          setEditMemberError(message);
        },
      },
    );
  };

  const handleDeleteMemberLogin = (u: AdminUser) => {
    setMemberMenuAnchor(null);
    setMemberMenuTarget(null);
    const message = `Delete ${u.full_name || u.username}'s login? If they've already been assigned real missions, this deactivates their account instead of deleting it.`;
    if (window.confirm(message)) deleteMemberLogin.mutate(u.id);
  };
  // Set while pre-filling the add-member form from an old no-login roster entry (see "Give
  // login" below) — once that new login is created, the legacy entry it came from is removed so
  // the person doesn't end up listed twice.
  const [convertingMemberId, setConvertingMemberId] = useState<number | null>(null);

  useEffect(() => {
    document.title = team ? `${team.name} — Insulator Inspector Pro` : 'Insulator Inspector Pro';
  }, [team]);

  // Leaflet doesn't notice its container resizing on its own (the enlarge toggle animates height
  // via CSS) — nudge it once the transition settles, same fix as TowersOverviewMap.
  useEffect(() => {
    const t = window.setTimeout(() => jobMapRef.current?.invalidateSize(), 220);
    return () => window.clearTimeout(t);
  }, [jobMapExpanded]);

  // team_member accounts get their own "Team members" card below — exclude them here so this
  // (admin-only) section is just about which login(s) count as this team's leader/tracking device.
  const linkedUsers = useMemo(
    () => enabledUsers?.filter((u) => u.team_id === id && u.role !== 'team_member') || [],
    [enabledUsers, id],
  );
  const unlinkedUsers = useMemo(
    () => enabledUsers?.filter((u) => u.team_id !== id && u.role !== 'team_member') || [],
    [enabledUsers, id],
  );
  const teamMemberLogins = useMemo(
    () => enabledUsers?.filter((u) => u.role === 'team_member' && u.team_id === id) || [],
    [enabledUsers, id],
  );

  const totals = useMemo(() => {
    if (!progress) return null;
    return progress.reduce(
      (acc, d) => ({
        towers: acc.towers + d.towers_visited,
        screened: acc.screened + d.screened,
        hotspots: acc.hotspots + d.hotspots,
      }),
      { towers: 0, screened: 0, hotspots: 0 },
    );
  }, [progress]);

  if (isError) {
    const status = (teamError as { response?: { status?: number } })?.response?.status;
    return (
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/teams')} sx={{ alignSelf: 'flex-start' }}>
          Back to teams
        </Button>
        <Alert severity={status === 403 ? 'warning' : 'error'}>
          {status === 403
            ? "You don't have access to this team."
            : 'Could not load this team.'}
        </Alert>
      </Stack>
    );
  }

  if (isLoading || !team) {
    return <LinearProgress />;
  }

  const commitField = (field: string, value: unknown) => {
    if (!canManage) return;
    updateTeam.mutate({ id, payload: { [field]: value } });
  };

  const points = (liveMembers || []).filter((m): m is NonNullable<typeof m> & { latitude: number; longitude: number } => m.latitude != null && m.longitude != null);
  const jobMapTowersWithCoords = (jobMap?.towers || []).filter((t) => t.latitude != null && t.longitude != null);
  const jobMapCenter: [number, number] =
    jobMapTowersWithCoords.length > 0
      ? [jobMapTowersWithCoords[0].latitude as number, jobMapTowersWithCoords[0].longitude as number]
      : [17.01972, 54.08972];

  const startStop = (stop: NextTowerStop) => {
    if (stop.visit_id) {
      if (stop.claim_id) {
        updateClaim.mutate({ claimId: stop.claim_id, payload: { visit_id: stop.visit_id, status: 'on_site' } });
      }
      navigate(`/visits/${stop.visit_id}`);
      return;
    }
    createMission.mutate(
      {
        tower_id: stop.id,
        inspection_date: nextPlan?.field_date || today,
        assigned_member_id: currentUser?.role === 'team_member' ? currentUser.id : null,
      },
      {
        onSuccess: async (visit) => {
          try {
            if (stop.claim_id) {
              await updateClaim.mutateAsync({ claimId: stop.claim_id, payload: { visit_id: visit.id } });
            } else {
              const claim = await claimTower.mutateAsync({ tower_id: stop.id });
              await updateClaim.mutateAsync({ claimId: claim.id, payload: { visit_id: visit.id } });
            }
          } catch {
            /* visit still opens */
          }
          navigate(`/visits/${visit.id}`);
        },
      },
    );
  };

  const focusJobMapTower = (t: { id: number; latitude: number | null; longitude: number | null }) => {
    if (t.latitude == null || t.longitude == null) return;
    setFocusedJobMapTowerId(t.id);
    jobMapRef.current?.flyTo([t.latitude, t.longitude], 17, { duration: 0.9 });
  };

  // OSRM's free public routing API — no key needed — returns an actual road-following geometry
  // (a long list of lat/lng points that trace real streets), plus the real driving distance/time,
  // the same job Google Maps' own directions do.
  const fetchDrivingRoute = async (origin: { lat: number; lng: number }, dest: { lat: number; lng: number }) => {
    setRouteFetchingPath(true);
    setRoutePathFailed(false);
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('routing service unavailable');
      const data = await res.json();
      const route = data?.routes?.[0];
      const coordinates: [number, number][] | undefined = route?.geometry?.coordinates;
      if (!coordinates || coordinates.length === 0) throw new Error('no route found');
      const coords: [number, number][] = coordinates.map(([lng, lat]) => [lat, lng]);
      setRoutePath(coords);
      setRouteDriving({ distanceKm: route.distance / 1000, durationMin: route.duration / 60 });
      jobMapRef.current?.fitBounds(L.latLngBounds(coords), { padding: [56, 56], maxZoom: 16 });
    } catch {
      setRoutePath(null);
      setRouteDriving(null);
      setRoutePathFailed(true);
    } finally {
      setRouteFetchingPath(false);
    }
  };

  const showRouteToTower = (t: { id: number; latitude: number | null; longitude: number | null }) => {
    if (t.latitude == null || t.longitude == null) return;
    setRouteError(null);
    if (!navigator.geolocation) {
      setRouteError('This browser cannot get your location, so a path can’t be drawn.');
      return;
    }
    setRoutingTowerId(t.id);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const dest = { lat: t.latitude as number, lng: t.longitude as number };
        setRouteOrigin(here);
        setRouteTowerId(t.id);
        setFocusedJobMapTowerId(t.id);
        setRoutingTowerId(null);
        setRoutePath(null);
        setRouteDriving(null);
        setRoutePathFailed(false);
        // Show the straight-line preview immediately (fitBounds so both points are visible while
        // the real road route loads), then swap it for the actual driving route once it arrives.
        jobMapRef.current?.fitBounds(L.latLngBounds([[here.lat, here.lng], [dest.lat, dest.lng]]), {
          padding: [56, 56],
          maxZoom: 16,
        });
        fetchDrivingRoute(here, dest);
      },
      (err) => {
        setRoutingTowerId(null);
        setRouteError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — allow location access to see the path here.'
            : 'Could not get your current location.',
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  };

  const clearJobMapRoute = () => {
    setRouteOrigin(null);
    setRouteTowerId(null);
    setRouteError(null);
    setRoutePath(null);
    setRouteDriving(null);
    setRouteFetchingPath(false);
    setRoutePathFailed(false);
  };

  const routeTower = jobMap?.towers.find((t) => t.id === routeTowerId) || null;
  const routeDistanceKm =
    routeOrigin && routeTower && routeTower.latitude != null && routeTower.longitude != null
      ? haversineMeters(routeOrigin.lat, routeOrigin.lng, routeTower.latitude, routeTower.longitude) / 1000
      : null;

  return (
    <Stack spacing={3}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/')} sx={{ alignSelf: 'flex-start' }}>
        Back to dashboard
      </Button>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          {team.name}
        </Typography>
        <Chip label={team.status} color={STATUS_COLORS[team.status] || 'default'} />
        {!team.is_active && <Chip label="Archived" variant="outlined" />}
        <Box sx={{ flex: 1 }} />
        {canManage && (
          <Button variant="outlined" startIcon={<DescriptionRoundedIcon />} onClick={openReportDialog}>
            Generate official report
          </Button>
        )}
      </Stack>

      {totals && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, sm: 2.4 }}>
            <KpiTile
              label={`Towers (${rangeStart} → ${rangeEnd})`}
              value={
                team.daily_target ? (
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
                    <span>{totals.towers}</span>
                    <Typography variant="caption" color="text.secondary">
                      / ~{team.daily_target * (progress?.length || 0)} planned
                    </Typography>
                  </Stack>
                ) : (
                  totals.towers
                )
              }
              icon={<CellTowerIcon />}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 2.4 }}>
            <KpiTile label="Positions screened" value={totals.screened} icon={<FactCheckIcon />} color="#3a6f84" />
          </Grid>
          <Grid size={{ xs: 6, sm: 2.4 }}>
            <KpiTile label="Hotspots found" value={totals.hotspots} icon={<LocalFireDepartmentIcon />} color="#d32f2f" />
          </Grid>
          <Grid size={{ xs: 6, sm: 2.4 }}>
            <KpiTile label="Roster size" value={team.members.length} icon={<PersonAddIcon />} color="#6d4c41" />
          </Grid>
          <Grid size={{ xs: 12, sm: 2.4 }}>
            <KpiTile
              label="Daily target (working plan)"
              value={team.daily_target ? `${team.daily_target}/day` : 'Not set'}
              icon={<FlagRoundedIcon />}
              color="#8a6d00"
            />
          </Grid>
        </Grid>
      )}

      <Card>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Site map
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Towers assigned to this team, your live pin, and tonight&apos;s track. Add a tower from
                the admin catalog — other teams cannot take it until you or an admin release it.
              </Typography>
            </Box>
            {canManage && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setClaimError(null); setClaimOpen(true); }}>
                Add tower
              </Button>
            )}
          </Stack>
          {canManage && (jobMap?.towers || []).length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
              {(jobMap?.towers || []).map((t) => (
                <Chip
                  key={t.id}
                  size="small"
                  label={t.tower_id}
                  onDelete={() => {
                    if (window.confirm(`Release ${t.tower_id} so another team can take it?`)) {
                      releaseTower.mutate(t.id);
                    }
                  }}
                  deleteIcon={<LockOpenIcon />}
                />
              ))}
            </Stack>
          )}
          <TeamSiteMap
            towers={jobMap?.towers}
            plannedIds={outingPlan?.tower_ids}
            liveMembers={liveMembers}
            trails={teamTrails}
            myLocation={
              lastLatitude != null && lastLongitude != null
                ? { latitude: lastLatitude, longitude: lastLongitude }
                : null
            }
            myLabel={currentUser?.full_name || currentUser?.username || 'You'}
            height={420}
          />
        </CardContent>
      </Card>
      <ClaimTowerDialog
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        freeTowers={freeTowers}
        claiming={claimForTeam.isPending}
        error={claimError}
        onClaim={(towerId) => {
          setClaimError(null);
          claimForTeam.mutate(towerId, {
            onError: (err: unknown) => {
              const message =
                (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                'Could not add that tower';
              setClaimError(String(message));
            },
          });
        }}
      />

      <Grid container spacing={2}>
        {/* Mission info — inline-editable, same pattern as the Visit header */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                Mission
              </Typography>
              <Stack spacing={2}>
                <Grid container spacing={2}>
                  <Grid size={6}>
                    <TextField
                      label="Team leader"
                      fullWidth
                      size="small"
                      defaultValue={team.leader_name || ''}
                      onBlur={(e) => commitField('leader_name', e.target.value || null)}
                    />
                  </Grid>
                  <Grid size={6}>
                    <TextField
                      label="Leader phone"
                      fullWidth
                      size="small"
                      defaultValue={team.leader_phone || ''}
                      onBlur={(e) => commitField('leader_phone', e.target.value || null)}
                    />
                  </Grid>
                </Grid>
                <TextField
                  label="Mission"
                  fullWidth
                  multiline
                  minRows={2}
                  size="small"
                  defaultValue={team.mission || ''}
                  onBlur={(e) => commitField('mission', e.target.value || null)}
                />
                <Grid container spacing={2}>
                  <Grid size={6}>
                    <TextField
                      label="From"
                      fullWidth
                      size="small"
                      defaultValue={team.mission_from || ''}
                      onBlur={(e) => commitField('mission_from', e.target.value || null)}
                    />
                  </Grid>
                  <Grid size={6}>
                    <TextField
                      label="To"
                      fullWidth
                      size="small"
                      defaultValue={team.mission_to || ''}
                      onBlur={(e) => commitField('mission_to', e.target.value || null)}
                    />
                  </Grid>
                </Grid>
                <Grid container spacing={2}>
                  <Grid size={4}>
                    <TextField
                      label="Start date"
                      type="date"
                      fullWidth
                      size="small"
                      defaultValue={team.start_date || ''}
                      onBlur={(e) => commitField('start_date', e.target.value || null)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  </Grid>
                  <Grid size={4}>
                    <TextField
                      label="End date"
                      type="date"
                      fullWidth
                      size="small"
                      defaultValue={team.end_date || ''}
                      onBlur={(e) => commitField('end_date', e.target.value || null)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  </Grid>
                  <Grid size={4}>
                    <TextField
                      label="Status"
                      select
                      fullWidth
                      size="small"
                      defaultValue={team.status}
                      onChange={(e) => commitField('status', e.target.value)}
                    >
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="paused">Paused</MenuItem>
                      <MenuItem value="completed">Completed</MenuItem>
                    </TextField>
                  </Grid>
                </Grid>
                <TextField
                  label="General notes"
                  fullWidth
                  multiline
                  minRows={2}
                  size="small"
                  defaultValue={team.notes || ''}
                  onBlur={(e) => commitField('notes', e.target.value || null)}
                  placeholder="Standing notes about this team (not day-specific — see the daily log below for that)"
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Linked logins (admin only — the endpoint that lists all users is admin-gated) */}
        {isAdmin && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                  Linked logins
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  The account(s) whose device pings and visits count toward this team's tracking &amp; progress —
                  usually just the leader's phone.
                </Typography>
                <Stack spacing={1} sx={{ mb: 2 }}>
                  {linkedUsers.map((u) => (
                    <Stack key={u.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Chip label={u.full_name || u.username} size="small" />
                      <Typography variant="caption" color="text.secondary">
                        {u.username}
                      </Typography>
                      <Tooltip title="Unlink from this team">
                        <IconButton size="small" onClick={() => updateUserMut.mutate({ id: u.id, payload: { team_id: null } })}>
                          <LinkOffIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  ))}
                  {linkedUsers.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No login linked yet.
                    </Typography>
                  )}
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField
                    select
                    size="small"
                    label="Link an existing account"
                    sx={{ minWidth: 220 }}
                    value={linkUserId}
                    onChange={(e) => setLinkUserId(e.target.value)}
                  >
                    <MenuItem value="" disabled>
                      {enabledUsers ? 'Choose a login' : 'Loading…'}
                    </MenuItem>
                    {unlinkedUsers.map((u) => (
                      <MenuItem key={u.id} value={u.id}>
                        {u.full_name || u.username} ({u.username})
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    startIcon={<LinkIcon />}
                    disabled={!linkUserId}
                    onClick={() => {
                      updateUserMut.mutate(
                        { id: Number(linkUserId), payload: { team_id: id } },
                        { onSuccess: () => setLinkUserId('') },
                      );
                    }}
                  >
                    Link
                  </Button>
                </Stack>

                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Create a new team-leader login
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Gives this team leader their own username and password — signed in, they'll see and
                  manage only this team's roster and missions, nothing from other teams.
                </Typography>
                {newLoginError && (
                  <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setNewLoginError(null)}>
                    {newLoginError}
                  </Alert>
                )}
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  <TextField
                    size="small"
                    label="Username"
                    value={newLoginForm.username}
                    onChange={(e) => setNewLoginForm((f) => ({ ...f, username: e.target.value }))}
                  />
                  <TextField
                    size="small"
                    label="Password"
                    type="password"
                    value={newLoginForm.password}
                    onChange={(e) => setNewLoginForm((f) => ({ ...f, password: e.target.value }))}
                  />
                  <TextField
                    size="small"
                    label="Full name"
                    value={newLoginForm.full_name}
                    onChange={(e) => setNewLoginForm((f) => ({ ...f, full_name: e.target.value }))}
                  />
                  <Button
                    variant="outlined"
                    startIcon={<PersonAddIcon />}
                    disabled={!newLoginForm.username.trim() || newLoginForm.password.length < 6 || createUserMut.isPending}
                    onClick={() => {
                      setNewLoginError(null);
                      createUserMut.mutate(
                        {
                          username: newLoginForm.username.trim(),
                          password: newLoginForm.password,
                          full_name: newLoginForm.full_name.trim() || undefined,
                          role: 'team_leader',
                          team_id: id,
                        },
                        {
                          onSuccess: () => setNewLoginForm({ username: '', password: '', full_name: '' }),
                          onError: (err: unknown) => {
                            const message =
                              (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                              'Could not create the login';
                            setNewLoginError(message);
                          },
                        },
                      );
                    }}
                  >
                    Create login
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Password needs at least 6 characters.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Team members — each gets their own username/password, created here by the leader (or
            admin); their whole app is scoped to just the missions assigned to them below. */}
        {(isAdmin || isTeamLeader) && (
          <Grid size={{ xs: 12, md: isAdmin ? 6 : 12 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                  Team members
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Each member has their own login — they'll only ever see the missions you assign to
                  them, never each other's or your details.
                </Typography>
                <Stack spacing={1} sx={{ mb: 2 }}>
                  {teamMemberLogins.map((u) => (
                    <Stack key={u.id} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Chip label={u.full_name || u.username} size="small" />
                      {u.job_type && <Chip label={u.job_type} size="small" variant="outlined" color="primary" />}
                      <Typography variant="caption" color="text.secondary">
                        {u.username}
                        {u.mobile ? ` · ${u.mobile}` : ''}
                      </Typography>
                      {!u.is_active && <Chip label="Deactivated" size="small" color="default" />}
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          setMemberMenuAnchor(e.currentTarget);
                          setMemberMenuTarget(u);
                        }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                  {teamMemberLogins.length === 0 && team.members.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No team members added yet.
                    </Typography>
                  )}
                </Stack>

                {team.members.length > 0 && (
                  <>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      From the old contact-only roster — not yet given a login:
                    </Typography>
                    <Stack spacing={0.75} sx={{ mb: 2 }}>
                      {team.members.map((m) => (
                        <Stack key={m.id} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Chip label={m.name} size="small" variant="outlined" />
                          {m.role_title && (
                            <Typography variant="caption" color="text.secondary">
                              {m.role_title}
                            </Typography>
                          )}
                          <Button
                            size="small"
                            onClick={() => {
                              setConvertingMemberId(m.id);
                              setMemberLoginForm((f) => ({
                                ...f,
                                full_name: m.name,
                                mobile: m.phone || '',
                                job_type: m.role_title || '',
                              }));
                            }}
                          >
                            Give login →
                          </Button>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              if (window.confirm(`Remove ${m.name}? They were never given a login.`)) removeMember.mutate(m.id);
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      ))}
                    </Stack>
                  </>
                )}

                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Add a team member
                </Typography>
                {convertingMemberId != null && (
                  <Alert severity="info" sx={{ mb: 1.5 }} onClose={() => setConvertingMemberId(null)}>
                    Giving {memberLoginForm.full_name} a login — just add a username &amp; password below.
                  </Alert>
                )}
                {memberLoginError && (
                  <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setMemberLoginError(null)}>
                    {memberLoginError}
                  </Alert>
                )}
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <TextField
                      size="small"
                      label="Full name"
                      value={memberLoginForm.full_name}
                      onChange={(e) => setMemberLoginForm((f) => ({ ...f, full_name: e.target.value }))}
                    />
                    <TextField
                      size="small"
                      label="Mobile"
                      value={memberLoginForm.mobile}
                      onChange={(e) => setMemberLoginForm((f) => ({ ...f, mobile: e.target.value }))}
                    />
                    <TextField
                      select
                      size="small"
                      label="Job type"
                      sx={{ minWidth: 180 }}
                      value={memberLoginForm.job_type}
                      onChange={(e) => setMemberLoginForm((f) => ({ ...f, job_type: e.target.value }))}
                    >
                      {JOB_TYPE_OPTIONS.map((j) => (
                        <MenuItem key={j} value={j}>
                          {j}
                        </MenuItem>
                      ))}
                      {memberLoginForm.job_type && !JOB_TYPE_OPTIONS.includes(memberLoginForm.job_type) && (
                        <MenuItem value={memberLoginForm.job_type}>{memberLoginForm.job_type} (custom)</MenuItem>
                      )}
                    </TextField>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <TextField
                      size="small"
                      label="Username"
                      value={memberLoginForm.username}
                      onChange={(e) => setMemberLoginForm((f) => ({ ...f, username: e.target.value }))}
                    />
                    <TextField
                      size="small"
                      label="Password"
                      type="password"
                      value={memberLoginForm.password}
                      onChange={(e) => setMemberLoginForm((f) => ({ ...f, password: e.target.value }))}
                    />
                    <Button
                      variant="outlined"
                      startIcon={<PersonAddIcon />}
                      disabled={!memberLoginForm.username.trim() || memberLoginForm.password.length < 6 || createMemberLogin.isPending}
                      onClick={() => {
                        setMemberLoginError(null);
                        createMemberLogin.mutate(
                          {
                            username: memberLoginForm.username.trim(),
                            password: memberLoginForm.password,
                            full_name: memberLoginForm.full_name.trim() || undefined,
                            mobile: memberLoginForm.mobile.trim() || undefined,
                            job_type: memberLoginForm.job_type.trim() || undefined,
                            notes: memberLoginForm.notes.trim() || undefined,
                            role: 'team_member',
                            team_id: id,
                          },
                          {
                            onSuccess: () => {
                              setMemberLoginForm({ full_name: '', mobile: '', job_type: '', username: '', password: '', notes: '' });
                              if (convertingMemberId != null) {
                                removeMember.mutate(convertingMemberId);
                                setConvertingMemberId(null);
                              }
                            },
                            onError: (err: unknown) => {
                              const message =
                                (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                                'Could not create this team member';
                              setMemberLoginError(message);
                            },
                          },
                        );
                      }}
                    >
                      Add member
                    </Button>
                  </Stack>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Password needs at least 6 characters — the member can change it themselves anytime once
                  signed in.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* This team's own GPS track, stays, and km — never another crew's. History lets them
          reopen any previous field night so they can continue from where they stopped. */}
      <Card>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Your track &amp; towers
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Only this team&apos;s GPS: kilometres so far, time at each tower, and which towers you have
                already checked. Open a previous night to continue the job.
              </Typography>
            </Box>
            <TextField
              select
              size="small"
              label="History"
              value={effectiveTrackKey}
              onChange={(e) => {
                setTrackKey(e.target.value);
                setTrackStayIdx(null);
              }}
              sx={{ minWidth: 260 }}
              helperText="Every saved outing stays here"
            >
              {shift?.field_date && (
                <MenuItem value={`night:${shift.field_date}`}>Tonight ({shift.field_date})</MenuItem>
              )}
              {(fieldHistory || [])
                .filter((m) => missionSelectKey(m) !== `night:${shift?.field_date || ''}`)
                .map((m) => (
                  <MenuItem key={missionSelectKey(m)} value={missionSelectKey(m)}>
                    {m.label}
                    {m.ping_count ? ` · ${m.ping_count} pts` : ''}
                  </MenuItem>
                ))}
            </TextField>
          </Stack>

          {recap ? (
            <>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <KpiTile label="Distance so far" value={`${recap.distance_km} km`} icon={<RouteIcon />} color="#1565c0" />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <KpiTile label="Time on the clock" value={`${recap.minutes_tracked} min`} icon={<TimerIcon />} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <KpiTile label="Towers this outing" value={recap.towers_visited} icon={<CellTowerIcon />} color="#2e7d32" />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <KpiTile
                    label="Avg stay / travel"
                    value={`${recap.avg_minutes_per_tower} / ${recap.avg_travel_minutes} min`}
                    icon={<DirectionsWalkIcon />}
                    color="#ef6c00"
                  />
                </Grid>
              </Grid>
              {recap.vs_previous && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  vs previous night: {recap.vs_previous.towers_delta >= 0 ? '+' : ''}
                  {recap.vs_previous.towers_delta} towers, {recap.vs_previous.distance_km_delta >= 0 ? '+' : ''}
                  {recap.vs_previous.distance_km_delta} km, avg stay {recap.vs_previous.avg_minutes_per_tower_delta >= 0 ? '+' : ''}
                  {recap.vs_previous.avg_minutes_per_tower_delta} min
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Started {formatTime(recap.started_at)} at {recap.start_latitude.toFixed(5)}, {recap.start_longitude.toFixed(5)}
                {' · '}
                Now / ended {formatTime(recap.ended_at)} at {recap.end_latitude.toFixed(5)}, {recap.end_longitude.toFixed(5)}
              </Typography>
              {recap.path.length > 0 && (
                <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)', height: 360, mb: 2 }}>
                  <MapContainer
                    center={[recap.start_latitude, recap.start_longitude]}
                    zoom={13}
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom
                  >
                    <TileLayer attribution={TILE_LAYERS.street.attribution} url={TILE_LAYERS.street.url} maxZoom={TILE_LAYERS.street.maxZoom} />
                    <TrackMapBridge mapRef={trackMapRef} />
                    <FitTrack
                      positions={recap.path.map((p) => [p.latitude, p.longitude] as [number, number])}
                      resetKey={`${effectiveTrackKey}-${recap.path.length}`}
                    />
                    {splitTrailSegments(recap.path).map((pts, i) => (
                      <Polyline key={i} positions={pts} pathOptions={{ color: '#2e7d32', weight: 4, opacity: 0.85 }} />
                    ))}
                    {points.map((m) => (
                      <Marker key={`live-${m.user_id}`} position={[m.latitude, m.longitude]} icon={dotIcon(m.is_stale ? '#90a4ae' : '#2e7d32')}>
                        <LeafletTooltip direction="top" offset={[0, -10]} opacity={1} permanent>
                          {m.full_name || m.username}
                        </LeafletTooltip>
                      </Marker>
                    ))}
                    {trackStay && trackStay.latitude != null && trackStay.longitude != null && (
                      <Marker
                        position={[trackStay.latitude, trackStay.longitude]}
                        icon={towerSquareIcon(trackStay.tower_id)}
                        zIndexOffset={2500}
                        eventHandlers={{ add: (e) => (e.target as L.Marker).openPopup() }}
                      >
                        <Popup autoPan={false}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{trackStay.tower_id}</Typography>
                          <Typography variant="caption" sx={{ display: 'block' }}>
                            {formatTime(trackStay.arrived_at)} – {formatTime(trackStay.departed_at)} · stayed {trackStay.minutes} min
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block' }}>
                            {trackNextStay
                              ? `Then moved to ${trackNextStay.tower_id} (${Math.max(0, Math.round((isoMs(trackNextStay.arrived_at) - isoMs(trackStay.departed_at)) / 60000))} min travel)`
                              : 'Last tower in this outing'}
                          </Typography>
                        </Popup>
                      </Marker>
                    )}
                  </MapContainer>
                </Box>
              )}
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Towers visited this outing — click a row to find it on the map
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tower</TableCell>
                      <TableCell>Travel from previous</TableCell>
                      <TableCell>Arrived</TableCell>
                      <TableCell>Left</TableCell>
                      <TableCell align="right">Minutes</TableCell>
                      <TableCell>Inspection</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recap.stays.map((stay, i) => (
                      <TableRow
                        key={`${stay.tower_pk}-${i}`}
                        hover
                        selected={i === trackStayIdx}
                        sx={{ cursor: stay.latitude != null ? 'pointer' : 'default' }}
                        onClick={() => {
                          setTrackStayIdx(i);
                          if (stay.latitude != null && stay.longitude != null) {
                            trackMapRef.current?.flyTo([stay.latitude, stay.longitude], 17, { duration: 0.75 });
                          }
                        }}
                      >
                        <TableCell sx={{ fontWeight: 700 }}>
                          {stay.tower_id}
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {stay.area || ''}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {stay.travel_from_prev_minutes == null
                            ? 'Start'
                            : `${stay.travel_from_prev_minutes} min${stay.travel_from_prev_km != null ? ` · ${stay.travel_from_prev_km} km` : ''}`}
                        </TableCell>
                        <TableCell>{formatTime(stay.arrived_at)}</TableCell>
                        <TableCell>{formatTime(stay.departed_at)}</TableCell>
                        <TableCell align="right">{stay.minutes}</TableCell>
                        <TableCell>
                          {stay.visit_id ? (
                            <Button size="small" onClick={(e) => { e.stopPropagation(); navigate(`/visits/${stay.visit_id}`); }}>
                              {stay.visit_status || 'open'}
                            </Button>
                          ) : (
                            <Typography variant="caption" color="text.secondary">GPS only</Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {recap.stays.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          No tower stays in this outing yet (GPS did not sit within 80 m of a tower).
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : (
            <Alert severity="info">
              No GPS track for this period yet. Open the app in the field with location on — the path,
              kilometres, and tower stays will appear here.
            </Alert>
          )}

          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            All inspections recorded for this team
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Every tower this crew has opened a visit for — so next outing you can finish what you started.
            {jobMap && jobMap.total > 0 ? ` Job map: ${jobMap.completed} of ${jobMap.total} assigned towers completed.` : ''}
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Tower</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Done</TableCell>
                  <TableCell align="center">Hotspots</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(missions || []).map((m) => (
                  <TableRow key={m.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/visits/${m.id}`)}>
                    <TableCell>{m.mission_seq}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{m.tower?.tower_id}</TableCell>
                    <TableCell>{m.inspection_date}</TableCell>
                    <TableCell>
                      <Chip size="small" label={String(m.mission_status).replace('_', ' ')} color={MISSION_STATUS_COLORS[m.mission_status] || 'default'} />
                    </TableCell>
                    <TableCell align="center">{m.rollup?.completion_pct ?? 0}%</TableCell>
                    <TableCell align="center">{m.rollup?.hotspots ?? 0}</TableCell>
                  </TableRow>
                ))}
                {(!missions || missions.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">No inspection visits recorded yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <OutingPlanCard
        teamId={id}
        fieldDate={shift?.field_date}
        assignedTowers={jobMap?.towers || []}
        canEdit={canManage}
      />

      <NextTowersCard
        plan={nextPlan}
        loading={nextPlanLoading}
        canStart={canRecord && !createMission.isPending}
        canAssign={canAssignClaims}
        currentUserId={currentUser?.id}
        busy={claimTower.isPending || updateClaim.isPending || createMission.isPending}
        onShow={(stop) => {
          focusJobMapTower(stop);
          showRouteToTower(stop);
        }}
        onStart={startStop}
        onClaim={(stop, userId) => claimTower.mutate({ tower_id: stop.id, assigned_user_id: userId })}
        onStatus={(stop, status: NightClaimStatus, skipReason) => {
          if (!stop.claim_id) return;
          updateClaim.mutate({ claimId: stop.claim_id, payload: { status, skip_reason: skipReason } });
        }}
      />

      <NightChannel
        teamId={id}
        fieldDate={shift?.field_date}
        towers={(jobMap?.towers || []).map((t) => ({ id: t.id, tower_id: t.tower_id }))}
        onTower={(towerPk, visitId) => {
          if (visitId) {
            navigate(`/visits/${visitId}`);
            return;
          }
          const t = jobMap?.towers.find((x) => x.id === towerPk);
          if (t) {
            focusJobMapTower(t);
            showRouteToTower(t);
          }
        }}
      />

      {/* Job map — the team's FULL assigned scope (every tower an admin has assigned to it via
          Towers page → select → "Assign to team"), not just the missions it already has. Lets a
          leader (or field crew planning the next drone flight) see the whole job at a glance, and
          measure progress against the whole thing, not just against what's been started. */}
      <Card>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Job map
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Every tower assigned to this team{jobMap?.sector ? ` (${jobMap.sector})` : ''} — not just the ones
                already visited — so the field crew can see the whole job and where to fly next.
              </Typography>
            </Box>
            {jobMap && jobMap.total > 0 && (
              <Stack direction="row" spacing={1}>
                <Chip size="small" label={`${jobMap.total} total`} />
                <Chip size="small" color="success" label={`${jobMap.completed} completed`} />
                <Chip size="small" color="info" label={`${jobMap.in_progress} in progress`} />
                <Chip size="small" variant="outlined" label={`${jobMap.pending} not started`} />
              </Stack>
            )}
          </Stack>

          {jobMap && jobMap.total > 0 && (
            <LinearProgress
              variant="determinate"
              value={(jobMap.completed / jobMap.total) * 100}
              sx={{ height: 8, borderRadius: 4, mb: 2 }}
            />
          )}

          {(!jobMap || jobMap.total === 0) && (
            <Alert severity="info">
              No towers assigned to this team yet. An admin can assign some from the Towers page —
              select the towers this team is responsible for, then "Assign to team" — to define the
              full scope of work here.
            </Alert>
          )}

          {jobMap && jobMap.total > 0 && (
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 2, maxHeight: 260 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Tower</TableCell>
                    <TableCell>Area</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobMap.towers.map((t) => {
                    const locatable = t.latitude != null && t.longitude != null;
                    const focused = t.id === focusedJobMapTowerId;
                    return (
                      <TableRow
                        key={t.id}
                        hover
                        selected={focused}
                        sx={{ cursor: locatable ? 'pointer' : 'default' }}
                        onClick={() => focusJobMapTower(t)}
                        title={locatable ? 'Click to find it on the map below' : 'No GPS location recorded for this tower yet'}
                      >
                        <TableCell sx={{ fontWeight: 600 }}>{t.tower_id}</TableCell>
                        <TableCell>{t.area || '-'}</TableCell>
                        <TableCell>
                          <Chip size="small" label={JOB_MAP_LABELS[t.status]} sx={{ bgcolor: JOB_MAP_COLORS[t.status], color: '#fff' }} />
                        </TableCell>
                        <TableCell align="right">
                          {locatable && (
                            <Tooltip title="Show path from my current location">
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={routingTowerId === t.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    showRouteToTower(t);
                                  }}
                                >
                                  {routingTowerId === t.id ? <CircularProgress size={16} /> : <DirectionsIcon fontSize="small" />}
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                          {t.visit_id && (
                            <Tooltip title="Open this visit">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/visits/${t.visit_id}`);
                                }}
                              >
                                <LinkIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {routeError && (
            <Alert severity="warning" onClose={() => setRouteError(null)} sx={{ mb: 2 }}>
              {routeError}
            </Alert>
          )}

          {jobMap && jobMap.total > 0 && (
            <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
              {/* Plain div, not MUI Box — react-leaflet only reads the height on first mount, so the
                  resizable height has to live on a wrapper it doesn't control (same fix as
                  TowersOverviewMap). Expanded uses vh so "enlarge" reads as most of the screen. */}
              <div
                style={{
                  position: 'relative',
                  height: jobMapExpanded ? '68vh' : 340,
                  width: '100%',
                  transition: 'height 0.2s ease',
                }}
              >
                <MapContainer
                  ref={jobMapRef}
                  center={jobMapCenter}
                  zoom={12}
                  style={{ height: '100%', width: '100%' }}
                  scrollWheelZoom
                >
                  <TileLayer
                    attribution={TILE_LAYERS[jobMapLayer].attribution}
                    url={TILE_LAYERS[jobMapLayer].url}
                    maxZoom={TILE_LAYERS[jobMapLayer].maxZoom}
                  />
                  {nextPlan && nextPlan.stops.length > 0 && (
                    <Polyline
                      positions={[
                        ...(nextPlan.origin_latitude != null && nextPlan.origin_longitude != null
                          ? [[nextPlan.origin_latitude, nextPlan.origin_longitude] as [number, number]]
                          : []),
                        ...nextPlan.stops.map((s) => [s.latitude, s.longitude] as [number, number]),
                      ]}
                      pathOptions={{ color: '#0d475c', weight: 4, opacity: 0.75 }}
                    />
                  )}
                  {nextPlan && nextPlan.origin_latitude != null && nextPlan.origin_longitude != null && !routeOrigin && (
                    <Marker position={[nextPlan.origin_latitude, nextPlan.origin_longitude]} icon={myLocationIcon()}>
                      <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
                        {nextPlan.origin_label || 'You are here'}
                      </LeafletTooltip>
                    </Marker>
                  )}
                  {jobMap.towers
                    .filter((t) => t.latitude != null && t.longitude != null)
                    // Render the focused tower's marker last so its red box sits on top of any
                    // neighboring markers instead of getting buried underneath them.
                    .sort((a, b) => (a.id === focusedJobMapTowerId ? 1 : 0) - (b.id === focusedJobMapTowerId ? 1 : 0))
                    .map((t) => {
                      const rank = nextPlan?.stops.find((s) => s.id === t.id)?.rank;
                      return (
                      <Marker
                        key={t.id}
                        position={[t.latitude as number, t.longitude as number]}
                        icon={
                          rank
                            ? planRankIcon(rank, JOB_MAP_COLORS[t.status])
                            : dotIcon(JOB_MAP_COLORS[t.status], t.id === focusedJobMapTowerId)
                        }
                        zIndexOffset={rank ? 800 : 0}
                        eventHandlers={{
                          click: () => {
                            focusJobMapTower(t);
                            if (t.visit_id) navigate(`/visits/${t.visit_id}`);
                          },
                        }}
                      >
                        <LeafletTooltip direction="top" offset={[0, -10]} opacity={1}>
                          <strong>{t.tower_id}</strong>
                          <br />
                          {t.area || ''}
                          <br />
                          {JOB_MAP_LABELS[t.status]}
                          {t.visit_id ? ' — click to open' : ''}
                          {rank ? ` — next #${rank}` : ''}
                        </LeafletTooltip>
                      </Marker>
                      );
                    })}
                  {routeOrigin && routeTower && routeTower.latitude != null && routeTower.longitude != null && (
                    <>
                      {routePath ? (
                        // The real road-following route from OSRM — solid, thicker, like Google
                        // Maps' own route line. Keyed distinctly from the dashed fallback below so
                        // React fully remounts the layer on switch, instead of Leaflet merging the
                        // new style onto the old one (setStyle doesn't clear a dropped dashArray).
                        <Polyline key="route-real" positions={routePath} pathOptions={{ color: '#1976d2', weight: 5, opacity: 0.85 }} />
                      ) : (
                        // Loading, or the routing service couldn't be reached — a straight-line
                        // stand-in so there's still *something* pointing the way.
                        <Polyline
                          key="route-fallback"
                          positions={[
                            [routeOrigin.lat, routeOrigin.lng],
                            [routeTower.latitude, routeTower.longitude],
                          ]}
                          pathOptions={{ color: '#1976d2', weight: 3, dashArray: '8 8' }}
                        />
                      )}
                      <Marker position={[routeOrigin.lat, routeOrigin.lng]} icon={myLocationIcon()}>
                        <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
                          You are here
                        </LeafletTooltip>
                      </Marker>
                    </>
                  )}
                </MapContainer>
                {routeOrigin && routeTower && (
                  <Paper
                    elevation={3}
                    sx={{
                      position: 'absolute',
                      top: 10,
                      left: 10,
                      zIndex: 1000,
                      p: 1,
                      pl: 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      maxWidth: 'calc(100% - 80px)',
                    }}
                  >
                    {routeFetchingPath ? <CircularProgress size={16} /> : <DirectionsIcon fontSize="small" color="primary" />}
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {routeFetchingPath
                        ? `Finding the driving route to ${routeTower.tower_id}…`
                        : routeDriving
                          ? `${routeDriving.distanceKm.toFixed(routeDriving.distanceKm < 10 ? 2 : 1)} km · ~${Math.round(
                              routeDriving.durationMin,
                            )} min drive to ${routeTower.tower_id}`
                          : routePathFailed
                            ? `Couldn't load a driving route — ${
                                routeDistanceKm != null ? `${routeDistanceKm.toFixed(1)} km straight-line` : 'showing straight line'
                              } to ${routeTower.tower_id}`
                            : `${routeDistanceKm != null ? `${routeDistanceKm.toFixed(1)} km` : ''} to ${routeTower.tower_id}`}
                    </Typography>
                    <Button
                      size="small"
                      component="a"
                      href={`https://www.google.com/maps/dir/?api=1&origin=${routeOrigin.lat},${routeOrigin.lng}&destination=${routeTower.latitude},${routeTower.longitude}&travelmode=driving`}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ ml: 0.5, whiteSpace: 'nowrap' }}
                    >
                      Navigate on phone ↗
                    </Button>
                    <Tooltip title="Clear path">
                      <IconButton size="small" onClick={clearJobMapRoute}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Paper>
                )}
                <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Tooltip title={jobMapLayer === 'street' ? 'Switch to satellite view' : 'Switch to street map'}>
                    <IconButton
                      size="small"
                      onClick={() => setJobMapLayer((v) => (v === 'street' ? 'satellite' : 'street'))}
                      sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}
                    >
                      {jobMapLayer === 'street' ? <SatelliteAltIcon fontSize="small" /> : <MapIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={jobMapExpanded ? 'Shrink map' : 'Enlarge map'}>
                    <IconButton
                      size="small"
                      onClick={() => setJobMapExpanded((v) => !v)}
                      sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}
                    >
                      {jobMapExpanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </Box>
              </div>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Missions — a mission IS a visit (Visit.team_id/mission_seq set), not a separate record.
          "Mission 1, 2, 3..." are this team's Visits in order; opening one goes straight to the
          full inspection workflow — positions, images, screening, photos, reports — since that's
          what actually running the mission means. */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            Missions
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Each mission is a tower visit assigned to this team, with a planned start/end time.
            Click one to open it and run the inspection — positions, images, screening, photos, all
            in the same place.
          </Typography>

          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Tower</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Assigned to</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Completion</TableCell>
                  <TableCell align="center">Hotspots</TableCell>
                  <TableCell align="center">Photos</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {missions?.map((m) => (
                  <TableRow key={m.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/visits/${m.id}`)}>
                    <TableCell sx={{ fontWeight: 700 }}>{m.mission_seq}</TableCell>
                    <TableCell>
                      <Chip size="small" icon={<PlaceIcon />} label={m.tower?.tower_id} variant="outlined" />
                      {m.tower?.latitude != null && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {m.tower.latitude.toFixed(5)}, {m.tower.longitude?.toFixed(5)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{m.inspection_date}</TableCell>
                    <TableCell>
                      {m.start_time?.slice(0, 5) || '-'}
                      {m.end_time ? ` – ${m.end_time.slice(0, 5)}` : ''}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canManage ? (
                      <TextField
                        select
                        size="small"
                        variant="standard"
                        sx={{ minWidth: 140 }}
                        value={m.assigned_member_id ?? ''}
                        onChange={(e) =>
                          updateVisit.mutate({ id: m.id, payload: { assigned_member_id: e.target.value ? Number(e.target.value) : null } })
                        }
                        slotProps={{ select: { displayEmpty: true } }}
                      >
                        <MenuItem value="">
                          <em>Unassigned</em>
                        </MenuItem>
                        {teamMemberLogins.map((u) => (
                          <MenuItem key={u.id} value={u.id}>
                            {u.full_name || u.username}
                          </MenuItem>
                        ))}
                      </TextField>
                      ) : (
                        <Typography variant="body2">{m.assigned_member_name || '—'}</Typography>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canManage ? (
                      <TextField
                        select
                        size="small"
                        variant="standard"
                        value={m.mission_status}
                        onChange={(e) => updateVisit.mutate({ id: m.id, payload: { mission_status: e.target.value } })}
                        slotProps={{
                          select: {
                            renderValue: (v) => (
                              <Chip size="small" label={String(v).replace('_', ' ')} color={MISSION_STATUS_COLORS[String(v)] || 'default'} />
                            ),
                          },
                        }}
                      >
                        <MenuItem value="planned">Planned</MenuItem>
                        <MenuItem value="in_progress">In progress</MenuItem>
                        <MenuItem value="completed">Completed</MenuItem>
                      </TextField>
                      ) : (
                        <Chip size="small" label={String(m.mission_status).replace('_', ' ')} color={MISSION_STATUS_COLORS[m.mission_status] || 'default'} />
                      )}
                    </TableCell>
                    <TableCell align="center">{m.rollup?.completion_pct ?? 0}%</TableCell>
                    <TableCell align="center">
                      {m.rollup && m.rollup.hotspots > 0 ? <Chip size="small" color="error" label={m.rollup.hotspots} /> : 0}
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                        <PhotoCameraIcon fontSize="inherit" color="disabled" />
                        <span>{m.photo_count}</span>
                      </Stack>
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      {canManage && (
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          if (window.confirm(`Delete Mission ${m.mission_seq} (${m.tower?.tower_id})? This removes the whole visit — positions, images, everything.`))
                            deleteVisit.mutate(m.id);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(!missions || missions.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={10} align="center">
                      No missions assigned yet — add the team's first stop below.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {canManage && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField
              select
              size="small"
              label="Tower"
              sx={{ minWidth: 160 }}
              value={missionForm.tower_id}
              onChange={(e) => setMissionForm((f) => ({ ...f, tower_id: e.target.value }))}
            >
              <MenuItem value="" disabled>
                {!towers ? 'Loading towers…' : teamTowers.length === 0 ? 'No towers assigned to this team yet' : 'Select a tower'}
              </MenuItem>
              {teamTowers.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.tower_id}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Date"
              type="date"
              size="small"
              value={missionForm.inspection_date}
              onChange={(e) => setMissionForm((f) => ({ ...f, inspection_date: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Start time"
              type="time"
              size="small"
              value={missionForm.start_time}
              onChange={(e) => setMissionForm((f) => ({ ...f, start_time: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="End time"
              type="time"
              size="small"
              value={missionForm.end_time}
              onChange={(e) => setMissionForm((f) => ({ ...f, end_time: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              size="small"
              label="Assign to"
              sx={{ minWidth: 160 }}
              value={missionForm.assigned_member_id}
              onChange={(e) => setMissionForm((f) => ({ ...f, assigned_member_id: e.target.value }))}
            >
              <MenuItem value="">
                <em>Unassigned</em>
              </MenuItem>
              {teamMemberLogins.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.full_name || u.username}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              disabled={!missionForm.tower_id || !missionForm.inspection_date || createMission.isPending}
              onClick={() => {
                createMission.mutate(
                  {
                    tower_id: Number(missionForm.tower_id),
                    inspection_date: missionForm.inspection_date,
                    start_time: missionForm.start_time || null,
                    end_time: missionForm.end_time || null,
                    assigned_member_id: missionForm.assigned_member_id ? Number(missionForm.assigned_member_id) : null,
                  },
                  {
                    onSuccess: (visit) => navigate(`/visits/${visit.id}`),
                  },
                );
              }}
            >
              Add mission &amp; open it
            </Button>
          </Stack>
          )}
        </CardContent>
      </Card>

      {/* Day-by-day progress + notes log */}
      <Card>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Daily progress log
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Type a note, record your voice, or attach several photos and PDFs (add photos, then add
                documents — they upload together).
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5}>
              <TextField
                label="From"
                type="date"
                size="small"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="To"
                type="date"
                size="small"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          </Stack>

          <input
            type="file"
            hidden
            multiple
            accept="image/*"
            ref={(el) => {
              morePhotoInput.current = el;
            }}
            onChange={(e) => {
              const list = Array.from(e.target.files || []);
              e.target.value = '';
              if (!list.length || addMoreNoteId == null) return;
              addNoteFiles.mutate({ log_date: '', files: list, noteId: addMoreNoteId });
              setAddMoreNoteId(null);
            }}
          />
          <input
            type="file"
            hidden
            multiple
            accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ref={(el) => {
              moreDocInput.current = el;
            }}
            onChange={(e) => {
              const list = Array.from(e.target.files || []);
              e.target.value = '';
              if (!list.length || addMoreNoteId == null) return;
              addNoteFiles.mutate({ log_date: '', files: list, noteId: addMoreNoteId });
              setAddMoreNoteId(null);
            }}
          />

          {progressLoading && <LinearProgress sx={{ mb: 2 }} />}

          <Stack spacing={2}>
            {progress?.map((day) => (
              <Paper key={day.log_date} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                  <Typography sx={{ fontWeight: 700 }}>{day.log_date}</Typography>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    {day.first_seen && (
                      <Chip
                        size="small"
                        icon={<ScheduleIcon />}
                        label={`${formatTime(day.first_seen)} – ${formatTime(day.last_seen)}`}
                        variant="outlined"
                      />
                    )}
                    <Chip
                      size="small"
                      label={team.daily_target ? `${day.towers_visited} / ${team.daily_target} towers` : `${day.towers_visited} towers`}
                      color={
                        team.daily_target
                          ? day.towers_visited >= team.daily_target
                            ? 'success'
                            : day.towers_visited > 0
                              ? 'warning'
                              : 'default'
                          : 'default'
                      }
                      variant={team.daily_target ? 'filled' : 'outlined'}
                    />
                    <Chip size="small" label={`${day.screened} screened`} />
                    {day.hotspots > 0 && <Chip size="small" color="error" label={`${day.hotspots} hotspots`} />}
                    <Chip size="small" variant="outlined" label={`${day.images_captured} images`} />
                  </Stack>
                </Stack>

                {(day.notes.length > 0 || queuedNotesForDay(day.log_date).length > 0) && (
                  <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                    {queuedNotesForDay(day.log_date).map((item) => {
                      const audio = item.kind === 'team-voice' ? previewUrl(item.id) : null;
                      return (
                        <Paper key={item.id} variant="outlined" sx={{ p: 1, borderStyle: 'dashed', borderColor: 'warning.main' }}>
                          {audio && <VoiceNotePlayer src={audio} duration={Number(item.json?.duration_seconds) || null} />}
                          <Typography variant="body2">{String(item.json?.note || item.label)}</Typography>
                          <Typography variant="caption" color="warning.main">
                            On this phone — {item.label}
                          </Typography>
                        </Paper>
                      );
                    })}
                    {day.notes.map((n) => {
                      const waitingConvert = n.has_audio && !n.transcribed;
                      const draft = transcriptDraft[n.id] ?? n.note;
                      return (
                      <Stack key={n.id} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          {n.has_audio && (
                            <VoiceNotePlayer
                              src={mediaUrl(`/api/teams/${id}/notes/${n.id}/audio`, n.created_at)}
                              duration={n.duration_seconds}
                            />
                          )}
                          {(n.attachments || []).length > 0 && (
                            <Stack spacing={1} sx={{ mt: 1 }}>
                              {n.attachments.map((f) => {
                                const href = mediaUrl(`/api/teams/${id}/notes/${n.id}/files/${f.id}`, n.created_at);
                                return (
                                  <Paper key={f.id} variant="outlined" sx={{ p: 1 }}>
                                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                      {f.is_image ? (
                                        <Box
                                          component="a"
                                          href={href}
                                          target="_blank"
                                          rel="noreferrer"
                                          sx={{ flexShrink: 0 }}
                                        >
                                          <Box
                                            component="img"
                                            src={href}
                                            alt={f.original_filename || 'photo'}
                                            sx={{
                                              width: 72,
                                              height: 72,
                                              objectFit: 'cover',
                                              borderRadius: 1,
                                              display: 'block',
                                            }}
                                          />
                                        </Box>
                                      ) : (
                                        <Box sx={{ width: 40, display: 'flex', justifyContent: 'center' }}>
                                          {f.is_pdf ? <PictureAsPdfIcon color="error" /> : <InsertDriveFileIcon color="action" />}
                                        </Box>
                                      )}
                                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={f.original_filename || ''}>
                                          {f.original_filename || 'File'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                          {f.is_image ? 'Image' : f.is_pdf ? 'PDF' : 'Document'}
                                          {f.file_size ? ` · ${formatBytes(f.file_size)}` : ''}
                                        </Typography>
                                      </Box>
                                      <Stack direction="row" sx={{ flexShrink: 0 }}>
                                        <Tooltip title="Open">
                                          <IconButton size="small" component="a" href={href} target="_blank" rel="noreferrer">
                                            <LinkIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                        {canLogNotes && (
                                          <>
                                            <Tooltip title="Rename">
                                              <IconButton
                                                size="small"
                                                onClick={() =>
                                                  setRenameTarget({
                                                    noteId: n.id,
                                                    fileId: f.id,
                                                    name: f.original_filename || '',
                                                  })
                                                }
                                              >
                                                <EditIcon fontSize="small" />
                                              </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Replace this file">
                                              <IconButton
                                                size="small"
                                                onClick={() => {
                                                  setReplaceTarget({ noteId: n.id, fileId: f.id });
                                                  replaceFileInput.current?.click();
                                                }}
                                              >
                                                <AttachFileIcon fontSize="small" />
                                              </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Delete this file only">
                                              <IconButton
                                                size="small"
                                                color="error"
                                                disabled={deleteNoteFile.isPending}
                                                onClick={() => {
                                                  if (
                                                    window.confirm(
                                                      `Delete ${f.original_filename || 'this file'}? Other files on this note stay.`,
                                                    )
                                                  ) {
                                                    deleteNoteFile.mutate({ noteId: n.id, fileId: f.id });
                                                  }
                                                }}
                                              >
                                                <DeleteIcon fontSize="small" />
                                              </IconButton>
                                            </Tooltip>
                                          </>
                                        )}
                                      </Stack>
                                    </Stack>
                                  </Paper>
                                );
                              })}
                            </Stack>
                          )}
                          {canLogNotes && (
                            <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                              <Button
                                size="small"
                                startIcon={<PhotoCameraIcon />}
                                onClick={() => {
                                  setAddMoreNoteId(n.id);
                                  morePhotoInput.current?.click();
                                }}
                              >
                                Add more photos
                              </Button>
                              <Button
                                size="small"
                                startIcon={<PictureAsPdfIcon />}
                                onClick={() => {
                                  setAddMoreNoteId(n.id);
                                  moreDocInput.current?.click();
                                }}
                              >
                                Add more PDF / Word
                              </Button>
                            </Stack>
                          )}
                          {waitingConvert && (!n.note || n.note === 'Voice note') ? (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              Recording saved. Convert it to text to use this note in reports.
                            </Typography>
                          ) : canLogNotes ? (
                            <TextField
                              size="small"
                              fullWidth
                              multiline
                              minRows={2}
                              value={draft}
                              onChange={(e) => setTranscriptDraft((d) => ({ ...d, [n.id]: e.target.value }))}
                              onBlur={() => {
                                const next = draft.trim();
                                if (next && next !== n.note) updateNote.mutate({ noteId: n.id, note: next });
                              }}
                              sx={{ mt: 0.75 }}
                              helperText={
                                n.has_audio
                                  ? 'Edit the transcript if needed — this text can go into the final report'
                                  : 'Edit this note — it can go into the final report'
                              }
                            />
                          ) : (
                            <Typography variant="body2" sx={{ mt: n.has_audio ? 0.5 : 0 }}>{n.note}</Typography>
                          )}
                          {canLogNotes && n.has_audio && (
                            <Button
                              size="small"
                              variant={waitingConvert ? 'contained' : 'outlined'}
                              startIcon={<SubtitlesIcon />}
                              sx={{ mt: 0.75 }}
                              disabled={transcribeNote.isPending}
                              onClick={() => {
                                setConvertError((e) => ({ ...e, [n.id]: '' }));
                                transcribeNote.mutate(n.id, {
                                  onSuccess: (saved) => {
                                    setTranscriptDraft((d) => ({ ...d, [n.id]: saved.note }));
                                  },
                                  onError: (err: unknown) => {
                                    const message =
                                      (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                                      'Could not convert this recording to text';
                                    setConvertError((e) => ({ ...e, [n.id]: message }));
                                  },
                                });
                              }}
                            >
                              {transcribeNote.isPending && transcribeNote.variables === n.id
                                ? 'Converting…'
                                : waitingConvert
                                  ? 'Convert to text'
                                  : 'Convert again'}
                            </Button>
                          )}
                          {convertError[n.id] && (
                            <Alert severity="warning" sx={{ mt: 0.75 }} onClose={() => setConvertError((e) => ({ ...e, [n.id]: '' }))}>
                              {convertError[n.id]}
                            </Alert>
                          )}
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            {n.created_by_name || 'Team'}
                            {n.has_audio ? (n.transcribed ? ' · voice + text' : ' · voice (not converted yet)') : ''}
                            {(n.attachments || []).length > 0 ? ` · ${n.attachments.length} file${n.attachments.length === 1 ? '' : 's'}` : ''}
                            {` · ${formatTime(n.created_at)}`}
                          </Typography>
                        </Box>
                        {canManage && (
                        <Tooltip title="Delete this whole note (all files in it)">
                        <IconButton
                          size="small"
                          onClick={() => {
                            const count = (n.attachments || []).length;
                            const extra = count ? ` This also removes ${count} attached file${count === 1 ? '' : 's'}. Use the trash on a file to remove only that one.` : '';
                            if (window.confirm(`Delete this whole note?${extra}`)) deleteNote.mutate(n.id);
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                        </Tooltip>
                        )}
                      </Stack>
                      );
                    })}
                  </Stack>
                )}

                {canLogNotes && (
                <>
                <Divider sx={{ my: 1.5 }} />
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Comment for this day — then Add text, Record, or Attach files…"
                    value={noteDraft[day.log_date] || ''}
                    onChange={(e) => setNoteDraft((d) => ({ ...d, [day.log_date]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && noteDraft[day.log_date]?.trim()) {
                        addNote.mutate(
                          { log_date: day.log_date, note: noteDraft[day.log_date].trim() },
                          { onSuccess: () => setNoteDraft((d) => ({ ...d, [day.log_date]: '' })) },
                        );
                      }
                    }}
                    sx={{ flex: '1 1 220px' }}
                  />
                  <Button
                    variant="outlined"
                    disabled={!noteDraft[day.log_date]?.trim() || addNote.isPending}
                    onClick={() => {
                      addNote.mutate(
                        { log_date: day.log_date, note: noteDraft[day.log_date].trim() },
                        { onSuccess: () => setNoteDraft((d) => ({ ...d, [day.log_date]: '' })) },
                      );
                    }}
                  >
                    Add text
                  </Button>
                  <VoiceNoteControls
                    disabled={addVoiceNote.isPending}
                    saving={addVoiceNote.isPending}
                    onRecorded={(blob, duration, liveTranscript) => {
                      const caption = (noteDraft[day.log_date] || '').trim() || liveTranscript || undefined;
                      addVoiceNote.mutate(
                        {
                          log_date: day.log_date,
                          file: blob,
                          duration_seconds: duration,
                          note: caption,
                        },
                        {
                          onSuccess: () => setNoteDraft((d) => ({ ...d, [day.log_date]: '' })),
                        },
                      );
                    }}
                  />
                  <input
                    type="file"
                    hidden
                    multiple
                    accept="image/*"
                    ref={(el) => {
                      photoInputByDate.current[day.log_date] = el;
                    }}
                    onChange={(e) => {
                      const list = Array.from(e.target.files || []);
                      setPendingFiles((p) => ({ ...p, [day.log_date]: mergeFiles(p[day.log_date] || [], list) }));
                      e.target.value = '';
                    }}
                  />
                  <input
                    type="file"
                    hidden
                    multiple
                    accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    ref={(el) => {
                      docInputByDate.current[day.log_date] = el;
                    }}
                    onChange={(e) => {
                      const list = Array.from(e.target.files || []);
                      setPendingFiles((p) => ({ ...p, [day.log_date]: mergeFiles(p[day.log_date] || [], list) }));
                      e.target.value = '';
                    }}
                  />
                  <Button
                    variant="outlined"
                    startIcon={<PhotoCameraIcon />}
                    disabled={addNoteFiles.isPending}
                    onClick={() => photoInputByDate.current[day.log_date]?.click()}
                  >
                    Add photos
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<AttachFileIcon />}
                    disabled={addNoteFiles.isPending}
                    onClick={() => docInputByDate.current[day.log_date]?.click()}
                  >
                    Add PDF / Word
                  </Button>
                </Stack>
                {(pendingFiles[day.log_date] || []).length > 0 && (
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {pendingFiles[day.log_date].length} file{pendingFiles[day.log_date].length === 1 ? '' : 's'} ready — tap Add photos or Add PDF / Word again to include more, then Upload.
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                      {pendingFiles[day.log_date].map((f, i) => (
                        <Chip key={`${f.name}-${f.size}-${i}`} size="small" label={f.name} onDelete={() => {
                          setPendingFiles((p) => ({
                            ...p,
                            [day.log_date]: (p[day.log_date] || []).filter((x) => x !== f),
                          }));
                        }} />
                      ))}
                    </Stack>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={addNoteFiles.isPending}
                      onClick={() => {
                        addNoteFiles.mutate(
                          {
                            log_date: day.log_date,
                            files: pendingFiles[day.log_date],
                            note: noteDraft[day.log_date]?.trim() || undefined,
                          },
                          {
                            onSuccess: () => {
                              setPendingFiles((p) => ({ ...p, [day.log_date]: [] }));
                              setNoteDraft((d) => ({ ...d, [day.log_date]: '' }));
                            },
                          },
                        );
                      }}
                    >
                      {addNoteFiles.isPending ? 'Uploading…' : `Upload ${pendingFiles[day.log_date].length} file${pendingFiles[day.log_date].length === 1 ? '' : 's'}`}
                    </Button>
                  </Stack>
                )}
                </>
                )}
              </Paper>
            ))}
            {!progressLoading && (!progress || progress.length === 0) && (
              <Alert severity="info">No days in this range yet.</Alert>
            )}
          </Stack>
        </CardContent>
      </Card>

      <input
        type="file"
        hidden
        accept="image/*,application/pdf,.pdf,.doc,.docx"
        ref={(el) => {
          replaceFileInput.current = el;
        }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !replaceTarget) return;
          replaceNoteFile.mutate({ noteId: replaceTarget.noteId, fileId: replaceTarget.fileId, file });
          setReplaceTarget(null);
        }}
      />
      <Dialog open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename file</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="File name"
            value={renameTarget?.name || ''}
            onChange={(e) => setRenameTarget((t) => (t ? { ...t, name: e.target.value } : t))}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!renameTarget?.name.trim() || renameNoteFile.isPending}
            onClick={() => {
              if (!renameTarget) return;
              renameNoteFile.mutate(
                { noteId: renameTarget.noteId, fileId: renameTarget.fileId, original_filename: renameTarget.name.trim() },
                { onSuccess: () => setRenameTarget(null) },
              );
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={reportDialogOpen} onClose={() => setReportDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Generate official report — {team.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Renders straight into the customer's own "Transmission Line Insulator Thermal Inspection Report"
              template — every position with real data in this date range becomes a finding.
            </Typography>
            {reportError && <Alert severity="error">{reportError}</Alert>}
            <TextField
              label="Report number"
              placeholder="e.g. OETC-DFRTRM-IR-2026-01"
              value={reportForm.report_number}
              onChange={(e) => setReportForm((f) => ({ ...f, report_number: e.target.value }))}
              autoFocus
              required
            />
            <Stack direction="row" spacing={2}>
              <TextField
                type="date"
                label="From"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={reportForm.start_date}
                onChange={(e) => setReportForm((f) => ({ ...f, start_date: e.target.value }))}
              />
              <TextField
                type="date"
                label="To"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={reportForm.end_date}
                onChange={(e) => setReportForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </Stack>
            <TextField
              select
              label="Overall condition"
              value={reportForm.overall_condition}
              onChange={(e) => setReportForm((f) => ({ ...f, overall_condition: e.target.value }))}
            >
              <MenuItem value="">
                <em>Not set</em>
              </MenuItem>
              {lists?.overall_condition.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Probable cause of thermal anomaly"
              multiline
              minRows={2}
              value={reportForm.probable_cause}
              onChange={(e) => setReportForm((f) => ({ ...f, probable_cause: e.target.value }))}
            />
            <TextField
              label="Recommended corrective action"
              multiline
              minRows={2}
              value={reportForm.corrective_action}
              onChange={(e) => setReportForm((f) => ({ ...f, corrective_action: e.target.value }))}
            />
            <TextField
              label="Additional comments"
              multiline
              minRows={2}
              value={reportForm.additional_comments}
              onChange={(e) => setReportForm((f) => ({ ...f, additional_comments: e.target.value }))}
            />
            <Typography variant="subtitle2">Approval</Typography>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Prepared by"
                fullWidth
                value={reportForm.prepared_by}
                onChange={(e) => setReportForm((f) => ({ ...f, prepared_by: e.target.value }))}
              />
              <TextField
                label="Reviewed by"
                fullWidth
                value={reportForm.reviewed_by}
                onChange={(e) => setReportForm((f) => ({ ...f, reviewed_by: e.target.value }))}
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Approved by"
                fullWidth
                value={reportForm.approved_by}
                onChange={(e) => setReportForm((f) => ({ ...f, approved_by: e.target.value }))}
              />
              <TextField
                type="date"
                label="Date"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={reportForm.approval_date}
                onChange={(e) => setReportForm((f) => ({ ...f, approval_date: e.target.value }))}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReportDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!reportForm.report_number.trim() || generateOetcReport.isPending}
            onClick={handleGenerateReport}
          >
            {generateOetcReport.isPending ? 'Generating…' : 'Generate & download'}
          </Button>
        </DialogActions>
      </Dialog>

      <Menu anchorEl={memberMenuAnchor} open={!!memberMenuAnchor} onClose={() => setMemberMenuAnchor(null)}>
        {memberMenuTarget && [
          <MenuItem key="edit" onClick={() => openMemberEdit(memberMenuTarget)}>
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit</ListItemText>
          </MenuItem>,
          <MenuItem
            key="toggle"
            onClick={() => {
              updateMemberLogin.mutate({ id: memberMenuTarget.id, payload: { is_active: !memberMenuTarget.is_active } });
              setMemberMenuAnchor(null);
              setMemberMenuTarget(null);
            }}
          >
            <ListItemIcon>
              {memberMenuTarget.is_active ? <LinkOffIcon fontSize="small" /> : <LinkIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{memberMenuTarget.is_active ? 'Deactivate login' : 'Reactivate login'}</ListItemText>
          </MenuItem>,
          <Divider key="div" />,
          <MenuItem key="delete" onClick={() => handleDeleteMemberLogin(memberMenuTarget)} sx={{ color: 'error.main' }}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

      <Dialog open={editMemberOpen} onClose={() => setEditMemberOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit {editingMember?.full_name || editingMember?.username}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {editMemberError && <Alert severity="error">{editMemberError}</Alert>}
            <TextField
              label="Full name"
              fullWidth
              value={editMemberForm.full_name}
              onChange={(e) => setEditMemberForm((f) => ({ ...f, full_name: e.target.value }))}
              autoFocus
            />
            <TextField
              label="Mobile"
              fullWidth
              value={editMemberForm.mobile}
              onChange={(e) => setEditMemberForm((f) => ({ ...f, mobile: e.target.value }))}
            />
            <TextField
              select
              label="Job type"
              fullWidth
              value={editMemberForm.job_type}
              onChange={(e) => setEditMemberForm((f) => ({ ...f, job_type: e.target.value }))}
            >
              {JOB_TYPE_OPTIONS.map((j) => (
                <MenuItem key={j} value={j}>
                  {j}
                </MenuItem>
              ))}
              {editMemberForm.job_type && !JOB_TYPE_OPTIONS.includes(editMemberForm.job_type) && (
                <MenuItem value={editMemberForm.job_type}>{editMemberForm.job_type} (custom)</MenuItem>
              )}
            </TextField>
            <TextField
              label="Notes"
              multiline
              minRows={2}
              value={editMemberForm.notes}
              onChange={(e) => setEditMemberForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <TextField
              label="Reset password (optional)"
              type="password"
              fullWidth
              value={editMemberForm.password}
              helperText="Leave blank to keep their current password"
              onChange={(e) => setEditMemberForm((f) => ({ ...f, password: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditMemberOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveMemberEdit} disabled={updateMemberLogin.isPending}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
