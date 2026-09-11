import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreenRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import 'leaflet/dist/leaflet.css';
import { TILE_LAYERS, type MapLayer } from './MapPicker';
import { splitTrailSegments } from '../utils/gpsTrail';
import type { LiveTeamMember, TeamJobMapTower, TrailPoint, UserTrail } from '../api/types';

const TOWER_COLORS: Record<string, string> = {
  completed: '#2e7d32',
  in_progress: '#1976d2',
  pending: '#9e9e9e',
};

function towerDot(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:2px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function crewDot(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function youIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:28px;height:28px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(13,71,92,0.22);"></div>
      <div style="position:absolute;top:50%;left:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#0d475c;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
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

function FitToPoints({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const key = positions.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) map.setView(positions[0], 15);
    else map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

export function TeamSiteMap({
  towers,
  liveMembers,
  trails,
  myLocation,
  myLabel = 'You',
  height = 380,
}: {
  towers?: TeamJobMapTower[];
  liveMembers?: LiveTeamMember[];
  trails?: UserTrail[];
  myLocation?: { latitude: number; longitude: number } | null;
  myLabel?: string;
  height?: number;
}) {
  const towerPts = (towers || []).filter((t) => t.latitude != null && t.longitude != null);
  const livePts = (liveMembers || []).filter(
    (m): m is LiveTeamMember & { latitude: number; longitude: number } =>
      m.latitude != null && m.longitude != null,
  );
  const trailPts = (trails || []).flatMap((t) => t.points);
  const positions: [number, number][] = [
    ...towerPts.map((t) => [t.latitude as number, t.longitude as number] as [number, number]),
    ...livePts.map((m) => [m.latitude, m.longitude] as [number, number]),
    ...trailPts.map((p) => [p.latitude, p.longitude] as [number, number]),
    ...(myLocation ? [[myLocation.latitude, myLocation.longitude] as [number, number]] : []),
  ];
  const center: [number, number] = positions[0] || [17.01972, 54.08972];
  const mapRef = useRef<L.Map | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [layer, setLayer] = useState<MapLayer>('street');
  const h = expanded ? Math.min(640, height * 1.7) : height;

  useEffect(() => {
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 220);
    return () => window.clearTimeout(id);
  }, [h]);

  if (positions.length === 0) {
    return (
      <Box
        sx={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'grey.100',
          borderRadius: 2,
        }}
      >
        <Typography color="text.secondary" variant="body2" sx={{ px: 2, textAlign: 'center' }}>
          No towers with GPS yet, and this phone has not sent a location. Tap Allow GPS tracking at
          the top, then this map will show you, your track, and the assigned towers.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" spacing={0.75} sx={{ mb: 1, flexWrap: 'wrap' }}>
        <Chip size="small" label="You" sx={{ bgcolor: '#0d475c', color: '#fff' }} />
        <Chip size="small" label="Track tonight" variant="outlined" color="success" />
        <Chip size="small" label="Tower done" sx={{ bgcolor: '#2e7d32', color: '#fff' }} />
        <Chip size="small" label="In progress" sx={{ bgcolor: '#1976d2', color: '#fff' }} />
        <Chip size="small" label="Not started" sx={{ bgcolor: '#9e9e9e', color: '#fff' }} />
      </Stack>
      <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
        <div style={{ position: 'relative', height: h, width: '100%', transition: 'height 0.2s ease' }}>
          <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer attribution={TILE_LAYERS[layer].attribution} url={TILE_LAYERS[layer].url} maxZoom={TILE_LAYERS[layer].maxZoom} />
            <MapRefBridge mapRef={mapRef} />
            <FitToPoints positions={positions} />
            {(trails || []).flatMap((trail) =>
              splitTrailSegments(trail.points as TrailPoint[]).map((pts, i) => (
                <Polyline
                  key={`${trail.user_id}-${i}`}
                  positions={pts}
                  pathOptions={{ color: '#2e7d32', weight: 5, opacity: 0.9 }}
                />
              )),
            )}
            {towerPts.map((t) => (
              <Marker
                key={`tw-${t.id}`}
                position={[t.latitude as number, t.longitude as number]}
                icon={towerDot(TOWER_COLORS[t.status] || '#9e9e9e')}
              >
                <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
                  <strong>{t.tower_id}</strong>
                  <br />
                  {t.area || ''}
                  <br />
                  {t.status === 'completed' ? 'Completed' : t.status === 'in_progress' ? 'In progress' : 'Not started'}
                </LeafletTooltip>
              </Marker>
            ))}
            {livePts.map((m) => (
              <Marker
                key={`lv-${m.user_id}`}
                position={[m.latitude, m.longitude]}
                icon={crewDot(m.is_stale ? '#90a4ae' : '#43a047')}
                zIndexOffset={600}
              >
                <LeafletTooltip direction="top" offset={[0, -10]} opacity={1}>
                  <strong>{m.full_name || m.username}</strong>
                  <br />
                  {m.is_stale ? 'Last seen' : 'Live'}
                </LeafletTooltip>
              </Marker>
            ))}
            {myLocation && (
              <Marker
                position={[myLocation.latitude, myLocation.longitude]}
                icon={youIcon()}
                zIndexOffset={1200}
              >
                <LeafletTooltip direction="top" offset={[0, -12]} opacity={1} permanent>
                  <strong>{myLabel}</strong>
                </LeafletTooltip>
              </Marker>
            )}
          </MapContainer>
          <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1000, display: 'flex', gap: 0.5 }}>
            <Tooltip title={layer === 'street' ? 'Satellite' : 'Map'}>
              <IconButton
                size="small"
                onClick={() => setLayer((l) => (l === 'street' ? 'satellite' : 'street'))}
                sx={{ bgcolor: 'white', '&:hover': { bgcolor: 'grey.100' } }}
              >
                {layer === 'street' ? <SatelliteAltIcon fontSize="small" /> : <MapIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title={expanded ? 'Smaller' : 'Larger'}>
              <IconButton
                size="small"
                onClick={() => setExpanded((v) => !v)}
                sx={{ bgcolor: 'white', '&:hover': { bgcolor: 'grey.100' } }}
              >
                {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        </div>
      </Box>
    </Box>
  );
}
