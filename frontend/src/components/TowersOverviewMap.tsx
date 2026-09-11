import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreenRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import 'leaflet/dist/leaflet.css';
import { severityColors } from '../theme/theme';
import type { DashboardTowerRow } from '../api/types';
import { useNavigate } from 'react-router-dom';
import { TILE_LAYERS, type MapLayer } from './MapPicker';

function markerIconFor(row: DashboardTowerRow) {
  let color = '#90a4ae';
  if (row.rollup) {
    if (row.rollup.hotspots > 0) color = severityColors.Critical;
    else if (row.rollup.visit_status === 'Evidence incomplete') color = severityColors.Medium;
    else if (row.rollup.visit_status === 'Inspection incomplete') color = severityColors.Low;
    else color = severityColors.Normal;
  }
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.35)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
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

// MapContainer's `center`/`zoom` props only ever apply on first mount (a react-leaflet quirk) — so
// switching a filter above the map (area, line sector, ...) would otherwise leave the view exactly
// where it started, with the newly-filtered markers potentially off-screen entirely. This refits
// the viewport to whatever points are currently showing, every time that set changes.
function FitToPoints({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const key = positions.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 13);
    } else {
      map.fitBounds(L.latLngBounds(positions), { padding: [32, 32], maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

export function TowersOverviewMap({
  rows,
  height = 340,
  onTowerClick,
}: {
  rows: DashboardTowerRow[];
  height?: number;
  onTowerClick?: (row: DashboardTowerRow) => void;
}) {
  const navigate = useNavigate();
  const points = rows.filter((r) => r.tower.latitude != null && r.tower.longitude != null);
  // Salalah, Oman — the real city at the center of the Dhofar/"Dufar" governorate this app's demo
  // data is set in (see MapPicker.tsx for the source).
  const center: [number, number] =
    points.length > 0 ? [points[0].tower.latitude as number, points[0].tower.longitude as number] : [17.01972, 54.08972];

  const mapRef = useRef<L.Map | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [layer, setLayer] = useState<MapLayer>('street');
  const currentHeight = expanded ? Math.min(680, height * 2) : height;

  useEffect(() => {
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 220);
    return () => window.clearTimeout(id);
  }, [currentHeight]);

  if (points.length === 0) {
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
        <Typography color="text.secondary">No towers with GPS coordinates yet</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
      {/* Plain div, not MUI Box — see MapPicker.tsx for why the resizable height can't live on
          MapContainer's own `style` prop (react-leaflet only applies it on first render). */}
      <div style={{ position: 'relative', height: currentHeight, width: '100%', transition: 'height 0.2s ease' }}>
        <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer
            attribution={TILE_LAYERS[layer].attribution}
            url={TILE_LAYERS[layer].url}
            maxZoom={TILE_LAYERS[layer].maxZoom}
          />
          <MapRefBridge mapRef={mapRef} />
          <FitToPoints positions={points.map((row) => [row.tower.latitude as number, row.tower.longitude as number])} />
          {points.map((row) => (
            <Marker
              key={row.tower.id}
              position={[row.tower.latitude as number, row.tower.longitude as number]}
              icon={markerIconFor(row)}
              eventHandlers={{
                click: () => {
                  if (onTowerClick) onTowerClick(row);
                  else navigate(`/towers/${row.tower.id}`);
                },
              }}
            >
              <LeafletTooltip direction="top" offset={[0, -10]} opacity={1}>
                <strong>{row.tower.tower_id}</strong>
                <br />
                {row.tower.voltage || '—'} · {row.tower.area || 'No area set'}
                {row.tower.tower_type ? (
                  <>
                    <br />
                    {row.tower.tower_type}
                  </>
                ) : null}
                {row.rollup && (
                  <>
                    <br />
                    {row.rollup.visit_status} · {row.rollup.hotspots} hotspot{row.rollup.hotspots === 1 ? '' : 's'}
                  </>
                )}
                <br />
                <em>Click to edit</em>
              </LeafletTooltip>
            </Marker>
          ))}
        </MapContainer>
        <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Tooltip title={layer === 'street' ? 'Switch to satellite view' : 'Switch to street map'}>
            <IconButton
              size="small"
              onClick={() => setLayer((v) => (v === 'street' ? 'satellite' : 'street'))}
              sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}
            >
              {layer === 'street' ? <SatelliteAltIcon fontSize="small" /> : <MapIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title={expanded ? 'Shrink map' : 'Enlarge map'}>
            <IconButton
              size="small"
              onClick={() => setExpanded((v) => !v)}
              sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}
            >
              {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      </div>
    </Box>
  );
}
