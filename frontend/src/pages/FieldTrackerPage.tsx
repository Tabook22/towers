import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Snackbar,
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
import GroupsIcon from '@mui/icons-material/GroupsRounded';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreenRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import RestartAltIcon from '@mui/icons-material/RestartAltRounded';
import { useNavigate } from 'react-router-dom';
import { useClaimTower, useDayReport, useLiveTeams, useShiftInfo, useStartTrackingMission, useTeamNextTowers, useTeams, useTowers, useTrackingChannel, useTrackingMissions, useUpdateClaim } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { NextTowersCard } from '../components/NextTowersCard';
import { HandoverPackCard } from '../components/HandoverPackCard';
import { DispatchChannelFeed, NightChannel } from '../components/NightChannel';
import type { LiveTeamMember, MovementDayReport, TrackingMission, TowerStay } from '../api/types';
import { TILE_LAYERS, type MapLayer } from '../components/MapPicker';
import { extractTowerNumber, numberedDotIcon, towerNumbersById } from '../components/towerMapPins';
import { splitTrailSegments } from '../utils/gpsTrail';
import {
  countByKind,
  latestOpsPins,
  OPS_FILTERS,
  opsColor,
  opsLabel,
  teamIdsWithKind,
  type OpsFilter,
} from '../utils/opsEvents';

// A small fixed palette, cycled by user id, so each technician keeps the same color across
// refreshes and between the map and the table (rather than a random color each render).
const PALETTE = ['#2e7d32', '#1565c0', '#ef6c00', '#8e24aa', '#00838f', '#c62828', '#6d4c41', '#455a64'];
function colorForUser(userId: number): string {
  return PALETTE[userId % PALETTE.length];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function teamLabel(m: { team_name: string | null; full_name: string | null; username: string }): string {
  return m.team_name || m.full_name || m.username;
}

function isoMs(iso: string): number {
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
}

function labeledIcon(color: string, stale: boolean, label: string) {
  const opacity = stale ? 0.55 : 1;
  return L.divIcon({
    className: 'team-live-label',
    html: `<div style="display:flex;flex-direction:column;align-items:center;opacity:${opacity};transform:translateY(-2px)">
      <div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></div>
      <div style="margin-top:3px;padding:2px 7px;border-radius:4px;background:rgba(15,58,77,.94);color:#fff;font:700 11px/15px system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35)">${escapeHtml(label)}</div>
    </div>`,
    iconSize: [160, 40],
    iconAnchor: [80, 8],
  });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
}

function clock(iso: string): string {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MapRefBridge({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

function FitToPoints({ positions, resetKey }: { positions: [number, number][]; resetKey: string }) {
  const map = useMap();
  const lastKey = useRef('');
  useEffect(() => {
    if (positions.length === 0) return;
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    if (positions.length === 1) map.setView(positions[0], 13);
    else map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  return null;
}

function MovingMarker({
  position,
  children,
  ...rest
}: {
  position: [number, number];
  children?: ReactNode;
} & ComponentProps<typeof Marker>) {
  const ref = useRef<L.Marker | null>(null);
  useEffect(() => {
    ref.current?.setLatLng(position);
  }, [position]);
  return (
    <Marker ref={ref} position={position} {...rest}>
      {children}
    </Marker>
  );
}

function parseHour(value: string): number | undefined {
  if (!value) return undefined;
  const hour = Number(value.slice(0, 2));
  return Number.isFinite(hour) ? hour : undefined;
}

// Mirrors backend/app/routers/tracking.py's STALE_AFTER_MINUTES — a crew is marked stale (grey,
// "Last seen") once its last ping is older than this. Used here only to word the went-quiet toast.
const STALE_AFTER_MINUTES = 2;

function missionKeyOf(m: TrackingMission): string {
  if (m.kind === 'night' || m.id == null) return `night:${m.field_date}`;
  return `mission:${m.id}`;
}

function catalogTowerIcon(highlighted: boolean) {
  const color = highlighted ? '#0d475c' : '#78909c';
  const size = highlighted ? 16 : 12;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:2px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3);opacity:${highlighted ? 1 : 0.8}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function opsEventIcon(kind: string, label: string) {
  const color = opsColor(kind);
  return L.divIcon({
    className: 'team-live-label',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-2px)">
      <div style="width:18px;height:18px;border-radius:3px;background:${color};border:2px solid #fff;transform:rotate(45deg);box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>
      <div style="margin-top:5px;padding:2px 7px;border-radius:4px;background:${color};color:#fff;font:700 11px/15px system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35)">${escapeHtml(label)}</div>
    </div>`,
    iconSize: [180, 48],
    iconAnchor: [90, 9],
  });
}

function towerSquareIcon(label: string) {
  return L.divIcon({
    className: 'team-live-label',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-2px)">
      <div style="width:20px;height:20px;background:#d32f2f;border:2px solid #fff;box-shadow:0 0 0 2px #d32f2f,0 1px 5px rgba(0,0,0,.45)"></div>
      <div style="margin-top:4px;padding:3px 8px;border-radius:4px;background:#c62828;color:#fff;font:700 12px/16px system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.4)">${escapeHtml(label)}</div>
    </div>`,
    iconSize: [220, 50],
    iconAnchor: [110, 10],
  });
}

function HighlightedTowerMarker({
  stay,
  nextStay,
  teamName,
}: {
  stay: TowerStay;
  nextStay?: TowerStay;
  teamName: string;
}) {
  const markerRef = useRef<L.Marker | null>(null);
  useEffect(() => {
    markerRef.current?.openPopup();
  }, [stay.tower_pk, stay.arrived_at, stay.departed_at]);
  if (stay.latitude == null || stay.longitude == null) return null;
  const travelMin = nextStay
    ? Math.max(0, Math.round((isoMs(nextStay.arrived_at) - isoMs(stay.departed_at)) / 60000))
    : null;
  return (
    <Marker
      ref={markerRef}
      position={[stay.latitude, stay.longitude]}
      icon={towerSquareIcon(stay.tower_id)}
      zIndexOffset={2500}
      eventHandlers={{
        add: (e) => {
          (e.target as L.Marker).openPopup();
        },
      }}
    >
      <Popup autoPan={false}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {stay.tower_id}
        </Typography>
        {stay.area && (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            {stay.area}
          </Typography>
        )}
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
          {teamName} was here {clock(stay.arrived_at)} – {clock(stay.departed_at)}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block' }}>
          Stayed {stay.minutes} min
          {nextStay
            ? ` before moving to ${nextStay.tower_id} (${travelMin} min travel)`
            : ' — last tower in this period'}
        </Typography>
      </Popup>
    </Marker>
  );
}

function CrewTrails({ reports, selectedUserId }: { reports: MovementDayReport[]; selectedUserId: number | null }) {
  return (
    <>
      {reports.flatMap((trail) => {
        const selected = trail.user_id === selectedUserId;
        return splitTrailSegments(trail.path).map((pts, i) => (
          <Polyline
            key={`${trail.user_id}-${i}`}
            positions={pts}
            pathOptions={{
              color: colorForUser(trail.user_id),
              weight: selected ? 5 : 3,
              opacity: selected ? 0.9 : 0.65,
            }}
          />
        ));
      })}
    </>
  );
}

export function FieldTrackerPage() {
  const { data: shift } = useShiftInfo();
  const [onDate, setOnDate] = useState('');
  const fieldDate = onDate || shift?.field_date || '';
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [teamId, setTeamId] = useState('');
  const claimTower = useClaimTower(teamId ? Number(teamId) : 0);
  const updateClaim = useUpdateClaim(teamId ? Number(teamId) : 0);
  const fromHour = parseHour(fromTime);
  const toHour = parseHour(toTime);
  const { data: teams } = useTeams();
  const { data: catalogTowers } = useTowers({ limit: 5000 });
  const { data: missions } = useTrackingMissions();
  const startMission = useStartTrackingMission();
  const [missionKey, setMissionKey] = useState('live');
  const [confirmNew, setConfirmNew] = useState(false);
  const currentMission = (missions || []).find((m) => m.is_current) || null;
  const selectedSaved = (missions || []).find((m) => missionKeyOf(m) === missionKey) || null;
  const viewingSaved = missionKey !== 'live' && !selectedSaved?.is_current;
  const reportMissionId =
    missionKey.startsWith('mission:')
      ? Number(missionKey.slice(8))
      : !viewingSaved && currentMission?.id
        ? currentMission.id
        : undefined;
  const reportDate = selectedSaved?.field_date || fieldDate;
  const reportFromHour = reportMissionId ? undefined : fromHour;
  const reportToHour = reportMissionId ? undefined : toHour;
  const { data: members, isLoading, error } = useLiveTeams(reportDate || undefined, Boolean(reportDate));
  const { data: dayReport } = useDayReport(
    reportDate || undefined,
    reportFromHour,
    reportToHour,
    teamId ? Number(teamId) : undefined,
    reportMissionId,
  );
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedStayIdx, setSelectedStayIdx] = useState<number | null>(null);
  const selectedReport = (dayReport || []).find((r) => r.user_id === selectedUserId) || null;
  const selectedLive = (members || []).find((m) => m.user_id === selectedUserId);
  const { data: nextPlan, isLoading: nextPlanLoading } = useTeamNextTowers(
    teamId ? Number(teamId) : undefined,
    selectedLive?.latitude,
    selectedLive?.longitude,
  );
  const { data: opsMessages } = useTrackingChannel(
    reportDate || undefined,
    teamId ? Number(teamId) : undefined,
  );
  const [opsFilter, setOpsFilter] = useState<OpsFilter>('all');
  const opsCounts = countByKind(opsMessages || []);
  const opsPins = latestOpsPins(opsMessages || [], opsFilter);
  const opsTeamIds = teamIdsWithKind(opsMessages || [], opsFilter);
  const selectedStay =
    selectedReport && selectedStayIdx != null ? selectedReport.stays[selectedStayIdx] ?? null : null;
  const nextStay =
    selectedReport && selectedStayIdx != null ? selectedReport.stays[selectedStayIdx + 1] : undefined;
  const [expanded, setExpanded] = useState(true);
  const [layer, setLayer] = useState<MapLayer>('street');
  const mapRef = useRef<L.Map | null>(null);
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  const height = expanded ? 620 : 420;

  // A dispatcher watching this board can easily miss a crew quietly flipping from Live to Last
  // seen among a long table — surface it as a toast the moment it happens, live→stale only (never
  // on first load, so a page refresh doesn't dump one toast per already-stale crew). This is the
  // one thing a web page CAN do about a phone going dark: it cannot stop the phone's own tracking
  // from pausing (screen lock, a call, an aggressive Android battery manager killing the tab), but
  // it can make sure dispatch notices fast instead of only spotting it later in the table.
  const prevStaleRef = useRef<Map<number, boolean> | null>(null);
  const [staleQueue, setStaleQueue] = useState<string[]>([]);
  const [staleToast, setStaleToast] = useState<string | null>(null);
  useEffect(() => {
    if (!members) return;
    const prev = prevStaleRef.current;
    const next = new Map<number, boolean>();
    const wentStale: string[] = [];
    for (const m of members) {
      next.set(m.user_id, m.is_stale);
      if (prev && prev.get(m.user_id) === false && m.is_stale) {
        wentStale.push(`${teamLabel(m)} has gone quiet — no GPS for over ${STALE_AFTER_MINUTES} min`);
      }
    }
    prevStaleRef.current = next;
    if (wentStale.length > 0) setStaleQueue((q) => [...q, ...wentStale]);
  }, [members]);
  useEffect(() => {
    if (!staleToast && staleQueue.length > 0) {
      setStaleToast(staleQueue[0]);
      setStaleQueue((q) => q.slice(1));
    }
  }, [staleQueue, staleToast]);

  useEffect(() => {
    setSelectedStayIdx(null);
  }, [selectedUserId, fieldDate, fromTime, toTime, teamId, missionKey]);

  useEffect(() => {
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 220);
    return () => window.clearTimeout(id);
  }, [height]);

  // Salalah, Oman — same fallback center used across the app's other maps.
  const hourFilter = viewingSaved || (!reportMissionId && (fromHour != null || toHour != null));
  const historyPins = (dayReport || [])
    .filter((r) => r.path.length > 0)
    .map((r) => {
      const last = r.path[r.path.length - 1];
      const live = !hourFilter ? members?.find((m) => m.user_id === r.user_id) : undefined;
      return {
        user_id: r.user_id,
        username: r.username,
        full_name: r.full_name,
        team_id: live?.team_id ?? r.team_id,
        team_name: r.team_name,
        latitude: live?.latitude ?? last.latitude,
        longitude: live?.longitude ?? last.longitude,
        last_seen: live?.last_seen ?? last.recorded_at,
        is_stale: live?.is_stale ?? true,
        accuracy_m: live?.accuracy_m ?? null,
        today: live?.today ?? { towers_visited: r.stays.length, visits_touched: 0, screened: 0, hotspots: 0 },
      };
    });
  const extraLive = (members || []).filter(
    (m) => m.latitude != null && m.longitude != null && !historyPins.some((p) => p.user_id === m.user_id),
  );
  const points = [...historyPins, ...extraLive].filter(
    (m): m is LiveTeamMember & { latitude: number; longitude: number } => m.latitude != null && m.longitude != null,
  );
  const visiblePoints =
    opsTeamIds == null
      ? points
      : points.filter((m) => m.team_id != null && opsTeamIds.has(m.team_id));
  const catalogWithGps = (catalogTowers || []).filter((t) => t.latitude != null && t.longitude != null);
  const catalogNumbers = towerNumbersById(catalogWithGps);
  const selectedTeamPk = teamId ? Number(teamId) : null;
  const fitPositions: [number, number][] =
    opsFilter !== 'all' && opsPins.length > 0
      ? opsPins.map((p) => [p.latitude as number, p.longitude as number])
      : visiblePoints.length > 0
        ? visiblePoints.map((m) => [m.latitude, m.longitude])
        : catalogWithGps.map((t) => [t.latitude as number, t.longitude as number]);
  const center: [number, number] =
    fitPositions.length > 0 ? fitPositions[0] : [17.01972, 54.08972];

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Field Tracker
        </Typography>
        <Typography color="text.secondary">
          Crew phones send GPS every minute while the app is open. Registered towers are on the map
          with the live tracks. This board refreshes every 10 seconds from mission start until now.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error">
          Couldn't load the field tracker. This page requires admin or reviewer access.
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          label="Field night of"
          type="date"
          size="small"
          value={reportDate}
          onChange={(e) => {
            setOnDate(e.target.value);
            setMissionKey(e.target.value ? `night:${e.target.value}` : 'live');
          }}
          helperText={shift?.label || '6:00 PM–6:00 PM Oman time'}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="From hour"
          type="time"
          size="small"
          value={fromTime}
          onChange={(e) => setFromTime(e.target.value)}
          helperText="e.g. 22:00"
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="To hour"
          type="time"
          size="small"
          value={toTime}
          onChange={(e) => setToTime(e.target.value)}
          helperText="e.g. 05:00"
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          select
          size="small"
          label="Team"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All teams</MenuItem>
          {(teams || []).map((t) => (
            <MenuItem key={t.id} value={String(t.id)}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Previous missions"
          value={missionKey}
          onChange={(e) => {
            const key = e.target.value;
            setMissionKey(key);
            setSelectedStayIdx(null);
            const picked = (missions || []).find((m) => missionKeyOf(m) === key);
            if (picked) setOnDate(picked.field_date);
            if (key !== 'live') {
              setFromTime('');
              setToTime('');
            }
          }}
          sx={{ minWidth: 260 }}
          helperText="Saved tracks — nothing is deleted"
        >
          <MenuItem value="live">{currentMission ? `Current · ${currentMission.label}` : 'Live now (this field night)'}</MenuItem>
          {missionKey.startsWith('night:') &&
            !(missions || []).some((m) => missionKeyOf(m) === missionKey) && (
              <MenuItem value={missionKey}>Field night {missionKey.slice(5)}</MenuItem>
            )}
          {(missions || [])
            .filter((m) => !m.is_current)
            .map((m) => (
              <MenuItem key={missionKeyOf(m)} value={missionKeyOf(m)}>
                {m.label}
                {m.ping_count ? ` · ${m.ping_count} pts` : ''}
              </MenuItem>
            ))}
        </TextField>
        <Button
          size="small"
          onClick={() => {
            setFromTime('22:00');
            setToTime('05:00');
            if (shift?.field_date) {
              setOnDate(shift.field_date);
              setMissionKey(`night:${shift.field_date}`);
            } else {
              setMissionKey('live');
            }
          }}
        >
          10pm–5am
        </Button>
        <Button
          size="small"
          onClick={() => {
            setFromTime('');
            setToTime('');
            setTeamId('');
            setMissionKey('live');
            setSelectedStayIdx(null);
            setOpsFilter('all');
            if (shift?.field_date) setOnDate(shift.field_date);
          }}
        >
          Live now
        </Button>
        <Button
          size="small"
          variant="contained"
          color="warning"
          startIcon={<RestartAltIcon />}
          onClick={() => setConfirmNew(true)}
          disabled={startMission.isPending}
        >
          New mission
        </Button>
        <Chip
          icon={<GroupsIcon />}
          label={`${visiblePoints.length} crew · ${catalogWithGps.length} towers · ${(dayReport || []).length} track${(dayReport || []).length === 1 ? '' : 's'}`}
          color={visiblePoints.length > 0 || catalogWithGps.length > 0 ? 'primary' : 'default'}
          variant="outlined"
        />
      </Stack>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
          Tonight&apos;s events
        </Typography>
        <Chip
          size="small"
          label="All"
          color={opsFilter === 'all' ? 'primary' : 'default'}
          variant={opsFilter === 'all' ? 'filled' : 'outlined'}
          onClick={() => setOpsFilter('all')}
        />
        {OPS_FILTERS.map((f) => (
          <Chip
            key={f.kind}
            size="small"
            label={`${f.label}${opsCounts[f.kind] ? ` · ${opsCounts[f.kind]}` : ''}`}
            onClick={() => setOpsFilter(opsFilter === f.kind ? 'all' : f.kind)}
            sx={{
              bgcolor: opsFilter === f.kind ? f.color : 'transparent',
              color: opsFilter === f.kind ? '#fff' : f.color,
              borderColor: f.color,
              '& .MuiChip-label': { fontWeight: 700 },
            }}
            variant={opsFilter === f.kind ? 'filled' : 'outlined'}
          />
        ))}
        {opsFilter !== 'all' && opsTeamIds && opsTeamIds.size === 0 && (
          <Typography variant="caption" color="text.secondary">
            No {opsLabel(opsFilter)} posts this field night
          </Typography>
        )}
      </Stack>

      {viewingSaved && selectedSaved && (
        <Alert severity="info">
          Viewing saved mission <strong>{selectedSaved.label}</strong>. GPS from this period is still stored.
          Click Live now to follow tonight, or New mission to start a clean map.
        </Alert>
      )}
      {!viewingSaved && currentMission && (
        <Alert severity="success">
          {currentMission.field_date === reportDate ? (
            <>
              Current mission started {clock(currentMission.started_at)} — the map only draws this
              outing. Open Previous missions to see anything recorded before this.
            </>
          ) : (
            <>
              Current mission has been running since {currentMission.field_date} (nobody has tapped
              New mission since) — to keep today's board readable, it only draws{' '}
              <strong>today's</strong> tracking. Nothing is deleted: open Previous missions, or set
              Field night to {currentMission.field_date}, to see the earlier days of this same
              outing.
            </>
          )}
        </Alert>
      )}

      {teamId && (
        <NextTowersCard
          plan={nextPlan}
          loading={nextPlanLoading}
          compact
          canAssign
          currentUserId={user?.id}
          busy={claimTower.isPending || updateClaim.isPending}
          onShow={(stop) => {
            mapBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            window.setTimeout(() => {
              mapRef.current?.flyTo([stop.latitude, stop.longitude], 15, { duration: 0.75 });
            }, 120);
          }}
          onClaim={(stop, userId) => claimTower.mutate({ tower_id: stop.id, assigned_user_id: userId })}
          onStatus={(stop, status, skipReason) => {
            if (!stop.claim_id) return;
            updateClaim.mutate({ claimId: stop.claim_id, payload: { status, skip_reason: skipReason } });
          }}
        />
      )}
      {teamId ? (
        <NightChannel
          teamId={Number(teamId)}
          fieldDate={reportDate || undefined}
          compact
          kindFilter={opsFilter}
          onTower={(_towerPk, visitId) => {
            if (visitId) navigate(`/visits/${visitId}`);
          }}
        />
      ) : (
        <DispatchChannelFeed
          fieldDate={reportDate || undefined}
          kindFilter={opsFilter}
          messages={opsMessages}
          onTower={(_towerPk, visitId) => {
            if (visitId) navigate(`/visits/${visitId}`);
          }}
        />
      )}
      {teamId && (
        <HandoverPackCard
          teamId={Number(teamId)}
          fieldDate={reportDate || undefined}
          canManage
          compact
          onShowTower={(towerPk, visitId) => {
            if (visitId) {
              navigate(`/visits/${visitId}`);
              return;
            }
            mapBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const t = (catalogTowers || []).find((row) => row.id === towerPk);
            if (t?.latitude != null && t?.longitude != null) {
              window.setTimeout(() => {
                mapRef.current?.flyTo([t.latitude as number, t.longitude as number], 15, { duration: 0.75 });
              }, 120);
            }
          }}
        />
      )}

      {isLoading && <LinearProgress />}

      <Box ref={mapBoxRef} sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
        <div style={{ position: 'relative', height, width: '100%', transition: 'height 0.2s ease' }}>
          <MapContainer center={center} zoom={fitPositions.length > 0 ? 12 : 10} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer attribution={TILE_LAYERS[layer].attribution} url={TILE_LAYERS[layer].url} maxZoom={TILE_LAYERS[layer].maxZoom} />
            <MapRefBridge mapRef={mapRef} />
            <FitToPoints
              positions={fitPositions}
              resetKey={`${missionKey}-${reportDate}-${fromTime}-${toTime}-${teamId}-${opsFilter}-${fitPositions.length}`}
            />
            {catalogWithGps.map((t) => {
              const mine = selectedTeamPk != null && t.assigned_team_id === selectedTeamPk;
              const n = extractTowerNumber(t.tower_id) ?? catalogNumbers.get(t.id);
              return (
                <Marker
                  key={`tw-${t.id}`}
                  position={[t.latitude as number, t.longitude as number]}
                  icon={
                    n != null
                      ? numberedDotIcon({
                          towerId: t.tower_id,
                          mapNumber: n,
                          color: mine || selectedTeamPk == null ? '#0d475c' : '#78909c',
                        })
                      : catalogTowerIcon(mine || selectedTeamPk == null)
                  }
                  zIndexOffset={mine ? 400 : 50}
                  eventHandlers={{
                    click: () => mapRef.current?.flyTo([t.latitude as number, t.longitude as number], 16, { duration: 0.5 }),
                  }}
                >
                  <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
                    <strong>
                      {n != null ? `#${n} · ` : ''}
                      {t.tower_id}
                    </strong>
                    {t.area ? ` · ${t.area}` : ''}
                  </LeafletTooltip>
                  <Popup>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      {t.tower_id}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {t.area || 'No area'}
                      {t.voltage ? ` · ${t.voltage}` : ''}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {t.assigned_team_name ? `Assigned: ${t.assigned_team_name}` : 'Not assigned to a team'}
                    </Typography>
                    <Button size="small" sx={{ mt: 0.5 }} onClick={() => navigate(`/towers/${t.id}`)}>
                      Open tower
                    </Button>
                  </Popup>
                </Marker>
              );
            })}
            {visiblePoints.map((m) => {
              const color = colorForUser(m.user_id);
              const approx = (m.accuracy_m ?? 0) > 2000;
              return (
                <MovingMarker
                  key={m.user_id}
                  position={[m.latitude as number, m.longitude as number]}
                  icon={labeledIcon(color, m.is_stale, teamLabel(m))}
                  eventHandlers={{ click: () => setSelectedUserId(m.user_id) }}
                >
                  <Popup>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {m.full_name || m.username}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {m.team_name || 'No team linked'}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {m.is_stale ? 'Last seen' : 'Live'}
                      {m.last_seen ? ` ${timeAgo(m.last_seen)}` : ''}
                      {approx ? ' · approximate' : ''}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                      Towers today: {m.today.towers_visited} · Screened: {m.today.screened} · Hotspots: {m.today.hotspots}
                    </Typography>
                  </Popup>
                </MovingMarker>
              );
            })}
            <CrewTrails
              reports={(dayReport || []).filter((r) => visiblePoints.some((p) => p.user_id === r.user_id))}
              selectedUserId={selectedUserId}
            />
            {opsPins.map((ev) => (
              <Marker
                key={`ops-${ev.id}`}
                position={[ev.latitude as number, ev.longitude as number]}
                icon={opsEventIcon(ev.kind, `${opsLabel(ev.kind)}${ev.tower_code ? ` · ${ev.tower_code}` : ''}`)}
                zIndexOffset={2000}
                eventHandlers={{
                  click: () => {
                    const crew = visiblePoints.find((p) => p.team_id === ev.team_id);
                    if (crew) setSelectedUserId(crew.user_id);
                  },
                }}
              >
                <Popup>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    {opsLabel(ev.kind)}
                    {ev.tower_code ? ` · ${ev.tower_code}` : ''}
                  </Typography>
                  {ev.team_name && (
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {ev.team_name}
                    </Typography>
                  )}
                  {ev.body && (
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {ev.body}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {ev.author_name || 'Crew'} · {clock(ev.created_at)}
                  </Typography>
                  {ev.visit_id && (
                    <Button size="small" sx={{ mt: 0.5 }} onClick={() => navigate(`/visits/${ev.visit_id}`)}>
                      Open visit
                    </Button>
                  )}
                </Popup>
              </Marker>
            ))}
            {selectedStay && (
              <HighlightedTowerMarker
                key={`${selectedStay.tower_pk}-${selectedStay.arrived_at}`}
                stay={selectedStay}
                nextStay={nextStay}
                teamName={teamLabel(selectedReport!)}
              />
            )}
          </MapContainer>
          <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Tooltip title={layer === 'street' ? 'Switch to satellite view' : 'Switch to street map'}>
              <IconButton size="small" onClick={() => setLayer((v) => (v === 'street' ? 'satellite' : 'street'))} sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}>
                {layer === 'street' ? <SatelliteAltIcon fontSize="small" /> : <MapIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title={expanded ? 'Shrink map' : 'Enlarge map'}>
              <IconButton size="small" onClick={() => setExpanded((v) => !v)} sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}>
                {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        </div>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Technician</TableCell>
              <TableCell>Team</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Tracked</TableCell>
              <TableCell align="center">Path km</TableCell>
              <TableCell align="center">Towers (GPS)</TableCell>
              <TableCell align="center">Visits</TableCell>
              <TableCell align="center">Hotspots</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visiblePoints.map((m) => (
              <TableRow
                key={m.user_id}
                hover
                selected={m.user_id === selectedUserId}
                sx={{ cursor: 'pointer' }}
                onClick={() => {
                  setSelectedUserId(m.user_id);
                  setSelectedStayIdx(null);
                  if (m.latitude != null && m.longitude != null) {
                    mapRef.current?.flyTo([m.latitude, m.longitude], 15);
                  }
                }}
              >
                <TableCell>
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: colorForUser(m.user_id), opacity: m.is_stale ? 0.45 : 1 }} />
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{m.full_name || m.username}</TableCell>
                <TableCell>
                  {m.team_name ? <Chip size="small" label={m.team_name} variant="outlined" /> : '-'}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={
                      !m.last_seen
                        ? 'Not reporting'
                        : m.is_stale
                          ? `Last seen ${timeAgo(m.last_seen)}`
                          : `Live · ${timeAgo(m.last_seen)}`
                    }
                    color={!m.last_seen ? 'warning' : m.is_stale ? 'default' : 'success'}
                    variant={m.is_stale || !m.last_seen ? 'outlined' : 'filled'}
                  />
                </TableCell>
                <TableCell align="center">
                  {dayReport?.find((r) => r.user_id === m.user_id)
                    ? `${dayReport.find((r) => r.user_id === m.user_id)!.minutes_tracked} min`
                    : '—'}
                </TableCell>
                <TableCell align="center">{dayReport?.find((r) => r.user_id === m.user_id)?.distance_km ?? '—'}</TableCell>
                <TableCell align="center">{dayReport?.find((r) => r.user_id === m.user_id)?.stays.length ?? 0}</TableCell>
                <TableCell align="center">{m.today.visits_touched}</TableCell>
                <TableCell align="center">{m.today.hotspots}</TableCell>
              </TableRow>
            ))}
            {!isLoading && visiblePoints.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  {opsFilter !== 'all'
                    ? `No crews posted ${opsLabel(opsFilter)} this field night.`
                    : 'No tracks in this date/hour range. Pick another field night or hours, or wait for a crew to start reporting and tap Allow when asked for location.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {selectedReport && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            {selectedReport.team_name || selectedReport.full_name || selectedReport.username} — {reportDate}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            First ping {clock(selectedReport.first_seen)} · last ping {clock(selectedReport.last_seen)} ·{' '}
            {selectedReport.minutes_tracked} min on the clock · {selectedReport.distance_km} km ·{' '}
            {selectedReport.ping_count} GPS points
          </Typography>
          {selectedReport.stays.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No tower stays recorded yet — a stay is counted when GPS stays within 80 m of a tower.
            </Typography>
          ) : (
            <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Click a tower to jump to it on the map — a red square marks it, with the last time this team was there and how long they stayed.
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Tower</TableCell>
                    <TableCell>Area</TableCell>
                    <TableCell>Arrived</TableCell>
                    <TableCell>Left</TableCell>
                    <TableCell align="right">Minutes</TableCell>
                    <TableCell>Visit</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selectedReport.stays.map((stay, i) => (
                    <TableRow
                      key={`${stay.tower_pk}-${i}`}
                      hover
                      selected={i === selectedStayIdx}
                      sx={{ cursor: stay.latitude != null ? 'pointer' : 'default' }}
                      onClick={() => {
                        setSelectedStayIdx(i);
                        mapBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        if (stay.latitude != null && stay.longitude != null) {
                          window.setTimeout(() => {
                            mapRef.current?.flyTo([stay.latitude as number, stay.longitude as number], 17, {
                              duration: 0.75,
                            });
                          }, 120);
                        }
                      }}
                    >
                      <TableCell sx={{ fontWeight: 700 }}>{stay.tower_id}</TableCell>
                      <TableCell>{stay.area || '—'}</TableCell>
                      <TableCell>{clock(stay.arrived_at)}</TableCell>
                      <TableCell>{clock(stay.departed_at)}</TableCell>
                      <TableCell align="right">{stay.minutes}</TableCell>
                      <TableCell>
                        {stay.visit_id ? (
                          <Button
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/visits/${stay.visit_id}`);
                            }}
                          >
                            {stay.visit_status || 'open'}
                          </Button>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            GPS only
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            </>
          )}
        </Paper>
      )}

      <Dialog open={confirmNew} onClose={() => setConfirmNew(false)}>
        <DialogTitle>Start a new mission?</DialogTitle>
        <DialogContent>
          <Typography>
            This clears the map so you can follow the next outing. Every GPS point already recorded
            stays saved — open it anytime from Previous missions.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmNew(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={startMission.isPending}
            onClick={() => {
              void startMission.mutateAsync().then(() => {
                setConfirmNew(false);
                setMissionKey('live');
                setFromTime('');
                setToTime('');
                setSelectedStayIdx(null);
                setSelectedUserId(null);
              });
            }}
          >
            Start new mission
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(staleToast)}
        autoHideDuration={7000}
        onClose={() => setStaleToast(null)}
        message={staleToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  );
}
