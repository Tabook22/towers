import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
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
import RouteIcon from '@mui/icons-material/RouteRounded';
import TimerIcon from '@mui/icons-material/TimerRounded';
import CellTowerIcon from '@mui/icons-material/CellTowerRounded';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalkRounded';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreenRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import { MapContainer, Marker, Polyline, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTheme } from '@mui/material/styles';
import { useShiftInfo, useTeamMissionProgress, useTeams } from '../api/hooks';
import { KpiTile } from '../components/KpiTile';
import { DEFAULT_MAP_LAYER, TILE_LAYERS, type MapLayer } from '../components/MapPicker';
import { HorizontalBarChart, type BarDatum } from '../components/HorizontalBarChart';
import { colorForTeam } from '../components/towerMapPins';
import { splitTrailSegments } from '../utils/gpsTrail';
import type { TeamProgress } from '../api/types';

function parseHour(value: string): number | undefined {
  if (!value) return undefined;
  const hour = Number(value.slice(0, 2));
  return Number.isFinite(hour) ? hour : undefined;
}

function clock(iso: string): string {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function datetime(iso: string): string {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDelta(n: number, unit = ''): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}${unit}`;
}

function startEndIcon(kind: 'start' | 'end') {
  const color = kind === 'start' ? '#2e7d32' : '#c62828';
  return L.divIcon({
    className: 'team-live-label',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function deltaChip(label: string, value: number, betterWhen: 'up' | 'down') {
  const good = betterWhen === 'up' ? value > 0 : value < 0;
  const color = value === 0 ? 'default' : good ? 'success' : 'warning';
  return <Chip size="small" color={color} label={`${label} ${fmtDelta(value)}`} variant="outlined" />;
}

export function TeamProgressPage() {
  const navigate = useNavigate();
  const { data: shift } = useShiftInfo();
  const [onDate, setOnDate] = useState('');
  const fieldDate = onDate || shift?.field_date || '';
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [teamId, setTeamId] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { data: teams } = useTeams();
  const { data, isLoading, error } = useTeamMissionProgress(
    fieldDate || undefined,
    parseHour(fromTime),
    parseHour(toTime),
    teamId ? Number(teamId) : undefined,
  );
  const selected = useMemo(
    () => (data || []).find((r) => `${r.team_id ?? r.logins[0]?.user_id}` === selectedKey) || data?.[0] || null,
    [data, selectedKey],
  );
  const comparisonCharts = useMemo(() => {
    const rows = data || [];
    const byValue = (pick: (r: TeamProgress) => number): BarDatum[] =>
      rows
        .map((r) => ({ label: r.team_name, value: pick(r), color: colorForTeam(r.team_id) }))
        .sort((a, b) => b.value - a.value);
    return {
      towers: byValue((r) => r.towers_visited),
      distance: byValue((r) => r.distance_km),
      onTowers: byValue((r) => r.dwell_minutes),
    };
  }, [data]);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Team Progress
        </Typography>
        <Typography color="text.secondary">
          Mission recap per team: start and end, kilometres, total time, minutes at each tower, and travel
          between towers. Compare with the previous field night to see day-to-day improvement.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error">Could not load team progress. Admin or reviewer access is required.</Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TextField
          label="Field night of"
          type="date"
          size="small"
          value={fieldDate}
          onChange={(e) => setOnDate(e.target.value)}
          helperText="6:00 PM–6:00 PM Oman"
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
        <TextField select size="small" label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All teams</MenuItem>
          {(teams || []).map((t) => (
            <MenuItem key={t.id} value={String(t.id)}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" onClick={() => { setFromTime('22:00'); setToTime('05:00'); }}>
          10pm–5am
        </Button>
        <Button
          size="small"
          onClick={() => {
            setFromTime('');
            setToTime('');
            setTeamId('');
            if (shift?.field_date) setOnDate(shift.field_date);
          }}
        >
          Tonight
        </Button>
      </Stack>

      {isLoading && <LinearProgress />}

      {!isLoading && (data || []).length > 0 && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <InsightsRoundedIcon color="primary" fontSize="small" />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Towers visited
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Towers visited per team in this window.
                </Typography>
                <HorizontalBarChart data={comparisonCharts.towers} emptyMessage="No towers visited yet." />
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <InsightsRoundedIcon color="primary" fontSize="small" />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Distance travelled
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Kilometres covered per team in this window.
                </Typography>
                <HorizontalBarChart data={comparisonCharts.distance} emptyMessage="No distance tracked yet." />
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <InsightsRoundedIcon color="primary" fontSize="small" />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Time on towers
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Minutes spent working at towers per team (excludes travel).
                </Typography>
                <HorizontalBarChart data={comparisonCharts.onTowers} emptyMessage="No time tracked yet." />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      <Grid container spacing={2}>
        {(data || []).map((row) => {
          const key = `${row.team_id ?? row.logins[0]?.user_id}`;
          const active = selected != null && `${selected.team_id ?? selected.logins[0]?.user_id}` === key;
          return (
            <Grid size={{ xs: 12, md: 6, lg: 4 }} key={key}>
              <Card variant={active ? 'elevation' : 'outlined'} sx={{ borderColor: active ? 'primary.main' : undefined, borderWidth: active ? 2 : 1 }}>
                <CardActionArea onClick={() => setSelectedKey(key)}>
                  <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      {row.team_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {clock(row.started_at)} → {clock(row.ended_at)} · {row.minutes_tracked} min · {row.distance_km} km
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                      <Chip size="small" label={`${row.towers_visited} towers`} />
                      <Chip size="small" label={`${row.dwell_minutes} min on towers`} />
                      <Chip size="small" label={`${row.travel_minutes} min travelling`} />
                    </Stack>
                    {row.vs_previous && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        vs previous night: {fmtDelta(row.vs_previous.towers_delta)} towers, {fmtDelta(row.vs_previous.distance_km_delta)} km
                      </Typography>
                    )}
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {!isLoading && (!data || data.length === 0) && (
        <Alert severity="info">No GPS tracks in this date/hour range yet.</Alert>
      )}

      {selected && <TeamMissionDetail row={selected} onOpenVisit={(id) => navigate(`/visits/${id}`)} />}
    </Stack>
  );
}

function TeamMissionDetail({ row, onOpenVisit }: { row: TeamProgress; onOpenVisit: (id: number) => void }) {
  const theme = useTheme();
  const pathPts = row.path.map((p) => [p.latitude, p.longitude] as [number, number]);
  const center: [number, number] = pathPts[0] || [17.01972, 54.08972];
  const segments = splitTrailSegments(row.path);
  const mapRef = useRef<L.Map | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mapLayer, setMapLayer] = useState<MapLayer>(DEFAULT_MAP_LAYER);
  // Leaflet doesn't notice its container resizing on its own (the enlarge toggle animates height
  // via CSS) — nudge it once the transition settles, same fix used on the other maps in this app.
  useEffect(() => {
    const t = window.setTimeout(() => mapRef.current?.invalidateSize(), 220);
    return () => window.clearTimeout(t);
  }, [mapExpanded]);

  return (
    <Stack spacing={2}>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>
        {row.team_name}
      </Typography>
      <Typography color="text.secondary">
        Started {datetime(row.started_at)} at {row.start_latitude.toFixed(5)}, {row.start_longitude.toFixed(5)}
        {' · '}
        Ended {datetime(row.ended_at)} at {row.end_latitude.toFixed(5)}, {row.end_longitude.toFixed(5)}
      </Typography>
      {row.logins.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          Crew: {row.logins.map((u) => u.full_name || u.username).join(', ')}
        </Typography>
      )}

      {row.vs_previous && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" sx={{ alignSelf: 'center' }}>
            vs previous field night ({String(row.vs_previous.field_date).slice(0, 10)}):
          </Typography>
          {deltaChip('Towers', row.vs_previous.towers_delta, 'up')}
          {deltaChip('km', row.vs_previous.distance_km_delta, 'up')}
          {deltaChip('Total min', row.vs_previous.minutes_tracked_delta, 'down')}
          {deltaChip('Min/tower', row.vs_previous.avg_minutes_per_tower_delta, 'down')}
        </Stack>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <KpiTile label="Total time" value={`${row.minutes_tracked} min`} icon={<TimerIcon />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <KpiTile label="Distance" value={`${row.distance_km} km`} icon={<RouteIcon />} color="#1565c0" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <KpiTile label="Towers" value={row.towers_visited} icon={<CellTowerIcon />} color="#2e7d32" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <KpiTile
            label="Avg time at tower"
            value={`${row.avg_minutes_per_tower} min`}
            icon={<TimerIcon />}
            color="#6a1b9a"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <KpiTile
            label="Avg travel between towers"
            value={`${row.avg_travel_minutes} min`}
            icon={<DirectionsWalkIcon />}
            color="#ef6c00"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <KpiTile
            label="On towers / travelling"
            value={`${row.dwell_minutes} / ${row.travel_minutes}`}
            icon={<RouteIcon />}
            color="#00838f"
          />
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
            Time breakdown
          </Typography>
          <HorizontalBarChart
            data={[
              { label: 'On towers', value: row.dwell_minutes, color: theme.palette.success.main },
              { label: 'Travelling', value: row.travel_minutes, color: theme.palette.warning.main },
            ]}
            emptyMessage="No time tracked yet."
          />
        </CardContent>
      </Card>

      {pathPts.length > 0 && (
        <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
          {/* Plain div, not MUI Box — react-leaflet only reads the height on first mount, so the
              resizable height has to live on a wrapper it doesn't control. Expanded uses vh so
              "enlarge" reads as most of the screen. */}
          <div style={{ position: 'relative', height: mapExpanded ? '68vh' : 320, width: '100%', transition: 'height 0.2s ease' }}>
            <MapContainer ref={mapRef} center={center} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
              <TileLayer attribution={TILE_LAYERS[mapLayer].attribution} url={TILE_LAYERS[mapLayer].url} maxZoom={TILE_LAYERS[mapLayer].maxZoom} />
              {segments.map((pts, i) => (
                <Polyline key={i} positions={pts} pathOptions={{ color: '#1565c0', weight: 4, opacity: 0.85 }} />
              ))}
              <Marker position={[row.start_latitude, row.start_longitude]} icon={startEndIcon('start')} />
              <Marker position={[row.end_latitude, row.end_longitude]} icon={startEndIcon('end')} />
            </MapContainer>
            <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Tooltip title={mapLayer === 'street' ? 'Switch to satellite view' : 'Switch to street map'}>
                <IconButton
                  size="small"
                  onClick={() => setMapLayer((v) => (v === 'street' ? 'satellite' : 'street'))}
                  sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}
                >
                  {mapLayer === 'street' ? <SatelliteAltIcon fontSize="small" /> : <MapIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title={mapExpanded ? 'Shrink map' : 'Enlarge map'}>
                <IconButton
                  size="small"
                  onClick={() => setMapExpanded((v) => !v)}
                  sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}
                >
                  {mapExpanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Box>
          </div>
        </Box>
      )}

      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tower</TableCell>
                <TableCell>Travel from previous</TableCell>
                <TableCell>Arrived</TableCell>
                <TableCell>Left</TableCell>
                <TableCell align="right">Minutes at tower</TableCell>
                <TableCell>Visit</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {row.stays.map((stay, i) => (
                <TableRow key={`${stay.tower_pk}-${i}`}>
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
                  <TableCell>{clock(stay.arrived_at)}</TableCell>
                  <TableCell>{clock(stay.departed_at)}</TableCell>
                  <TableCell align="right">{stay.minutes}</TableCell>
                  <TableCell>
                    {stay.visit_id ? (
                      <Button size="small" onClick={() => onOpenVisit(stay.visit_id!)}>
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
              {row.stays.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    No tower stays in this period (GPS did not sit within 80 m of a tower).
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}
