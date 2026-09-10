import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Alert,
  Box,
  Chip,
  IconButton,
  LinearProgress,
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
import GroupsIcon from '@mui/icons-material/GroupsRounded';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreenRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import { useLiveTeams, useUserTrail } from '../api/hooks';
import { TILE_LAYERS, type MapLayer } from '../components/MapPicker';
import type { LiveTeamMember } from '../api/types';

// A small fixed palette, cycled by user id, so each technician keeps the same color across
// refreshes and between the map and the table (rather than a random color each render).
const PALETTE = ['#2e7d32', '#1565c0', '#ef6c00', '#8e24aa', '#00838f', '#c62828', '#6d4c41', '#455a64'];
function colorForUser(userId: number): string {
  return PALETTE[userId % PALETTE.length];
}

function dotIcon(color: string, stale: boolean) {
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};opacity:${stale ? 0.45 : 1};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.35)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
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

function SelectedTrail({ userId, onDate, color }: { userId: number; onDate: string; color: string }) {
  const { data: trail } = useUserTrail(userId, onDate);
  const points = (trail || []).map((p) => [p.latitude, p.longitude] as [number, number]);
  if (points.length < 2) return null;
  return <Polyline positions={points} pathOptions={{ color, weight: 3, opacity: 0.8 }} />;
}

export function FieldTrackerPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [onDate, setOnDate] = useState(today);
  const { data: members, isLoading, error } = useLiveTeams(onDate);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [layer, setLayer] = useState<MapLayer>('street');
  const mapRef = useRef<L.Map | null>(null);
  const height = expanded ? 620 : 420;

  useEffect(() => {
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 220);
    return () => window.clearTimeout(id);
  }, [height]);

  // Salalah, Oman — same fallback center used across the app's other maps.
  const points = (members || []).filter((m) => m.latitude != null && m.longitude != null);
  const center: [number, number] = points.length > 0 ? [points[0].latitude, points[0].longitude] : [17.01972, 54.08972];

  const selected = useMemo(() => members?.find((m) => m.user_id === selectedUserId) || null, [members, selectedUserId]);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Field Tracker
        </Typography>
        <Typography color="text.secondary">
          Live technician locations and today's inspection progress — each crew's phone reports its position
          while the app is open, so you can see where every team is and how many towers they've covered.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error">
          Couldn't load the field tracker. This page requires admin or reviewer access.
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          label="Date"
          type="date"
          size="small"
          value={onDate}
          onChange={(e) => setOnDate(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Chip
          icon={<GroupsIcon />}
          label={`${points.length} team${points.length === 1 ? '' : 's'} reporting`}
          color={points.length > 0 ? 'primary' : 'default'}
          variant="outlined"
        />
      </Stack>

      {isLoading && <LinearProgress />}

      <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
        <div style={{ position: 'relative', height, width: '100%', transition: 'height 0.2s ease' }}>
          <MapContainer center={center} zoom={points.length > 0 ? 12 : 10} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer attribution={TILE_LAYERS[layer].attribution} url={TILE_LAYERS[layer].url} maxZoom={TILE_LAYERS[layer].maxZoom} />
            <MapRefBridge mapRef={mapRef} />
            {points.map((m) => {
              const color = colorForUser(m.user_id);
              return (
                <Marker
                  key={m.user_id}
                  position={[m.latitude, m.longitude]}
                  icon={dotIcon(color, m.is_stale)}
                  eventHandlers={{ click: () => setSelectedUserId(m.user_id) }}
                >
                  <LeafletTooltip direction="top" offset={[0, -10]} opacity={1}>
                    <strong>{m.full_name || m.username}</strong>
                    <br />
                    {m.is_stale ? 'Last seen' : 'Active'} · {timeAgo(m.last_seen)}
                  </LeafletTooltip>
                  <Popup>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {m.full_name || m.username}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {m.is_stale ? 'Last seen' : 'Active'} {timeAgo(m.last_seen)}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                      Towers today: {m.today.towers_visited} · Screened: {m.today.screened} · Hotspots: {m.today.hotspots}
                    </Typography>
                  </Popup>
                </Marker>
              );
            })}
            {selected && <SelectedTrail userId={selected.user_id} onDate={onDate} color={colorForUser(selected.user_id)} />}
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
              <TableCell align="center">Towers today</TableCell>
              <TableCell align="center">Visits touched</TableCell>
              <TableCell align="center">Screened</TableCell>
              <TableCell align="center">Hotspots</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(members || []).map((m: LiveTeamMember) => (
              <TableRow
                key={m.user_id}
                hover
                selected={m.user_id === selectedUserId}
                sx={{ cursor: 'pointer' }}
                onClick={() => {
                  setSelectedUserId(m.user_id);
                  mapRef.current?.flyTo([m.latitude, m.longitude], 15);
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
                    label={m.is_stale ? `Last seen ${timeAgo(m.last_seen)}` : `Active · ${timeAgo(m.last_seen)}`}
                    color={m.is_stale ? 'default' : 'success'}
                    variant={m.is_stale ? 'outlined' : 'filled'}
                  />
                </TableCell>
                <TableCell align="center">{m.today.towers_visited}</TableCell>
                <TableCell align="center">{m.today.visits_touched}</TableCell>
                <TableCell align="center">{m.today.screened}</TableCell>
                <TableCell align="center">{m.today.hotspots}</TableCell>
              </TableRow>
            ))}
            {!isLoading && (!members || members.length === 0) && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  No teams have reported a location for this date yet. Tracking starts automatically once a
                  technician is signed in with location sharing enabled (see the tracking indicator in the header).
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
