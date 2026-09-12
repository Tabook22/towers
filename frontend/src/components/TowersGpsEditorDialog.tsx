import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Dialog,
  IconButton,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/CloseRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import 'leaflet/dist/leaflet.css';
import { TILE_LAYERS, type MapLayer } from './MapPicker';
import { assignmentPinIcon, towerNumbersById } from './towerMapPins';
import { usePatchTowerLocation } from '../api/hooks';
import type { TowerWithStats } from '../api/types';

function FitToPoints({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const key = positions.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) map.setView(positions[0], 15);
    else map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

export function TowersGpsEditorDialog({
  open,
  onClose,
  towers,
}: {
  open: boolean;
  onClose: () => void;
  towers: TowerWithStats[];
}) {
  const withGps = useMemo(
    () => (towers || []).filter((t) => t.latitude != null && t.longitude != null),
    [towers],
  );
  const numbers = useMemo(() => towerNumbersById(withGps), [withGps]);
  const fitPositions = useMemo(
    () => withGps.map((t) => [t.latitude as number, t.longitude as number] as [number, number]),
    // Fit once from catalog GPS, not after every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [withGps.map((t) => t.id).join(',')],
  );
  const [layer, setLayer] = useState<MapLayer>('street');
  const [overrides, setOverrides] = useState<Record<number, { lat: number; lng: number }>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patchGps = usePatchTowerLocation();
  const saving = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!open) {
      setOverrides({});
      setStatus(null);
      setError(null);
    }
  }, [open]);

  const posOf = (t: TowerWithStats): [number, number] => {
    const o = overrides[t.id];
    if (o) return [o.lat, o.lng];
    return [t.latitude as number, t.longitude as number];
  };

  const handleDragEnd = (t: TowerWithStats, marker: L.Marker) => {
    const p = marker.getLatLng();
    const lat = Number(p.lat.toFixed(6));
    const lng = Number(p.lng.toFixed(6));
    setOverrides((prev) => ({ ...prev, [t.id]: { lat, lng } }));
    setError(null);
    saving.current.add(t.id);
    const n = numbers.get(t.id);
    patchGps.mutate(
      { id: t.id, latitude: lat, longitude: lng },
      {
        onSuccess: () => {
          saving.current.delete(t.id);
          setStatus(`Saved ${n != null ? `#${n} ` : ''}${t.tower_id} → ${lat}, ${lng}`);
        },
        onError: (err: unknown) => {
          saving.current.delete(t.id);
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(typeof detail === 'string' ? detail : `Could not save ${t.tower_id}`);
        },
      },
    );
  };

  const center: [number, number] = fitPositions[0] || [17.01972, 54.08972];

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <AppBar sx={{ position: 'relative' }} color="default" elevation={1}>
        <Toolbar>
          <Typography sx={{ flex: 1, fontWeight: 800 }} variant="h6">
            Move towers on the map
          </Typography>
          <Button color="inherit" onClick={onClose} startIcon={<CloseIcon />}>
            Done
          </Button>
        </Toolbar>
      </AppBar>
      <Stack sx={{ height: '100%', minHeight: 0 }}>
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <Typography variant="body2" color="text.secondary">
            Drag any numbered pin. GPS is saved as soon as you drop it — no extra Save click.
            {withGps.length ? ` Showing ${withGps.length} tower${withGps.length === 1 ? '' : 's'} with coordinates.` : ''}
          </Typography>
          {status && (
            <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.5 }}>
              {status}
            </Typography>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {withGps.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 3 }}>
              No towers have GPS yet. Add or edit a tower and drop a pin first.
            </Typography>
          ) : (
            <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
              <TileLayer
                attribution={TILE_LAYERS[layer].attribution}
                url={TILE_LAYERS[layer].url}
                maxZoom={TILE_LAYERS[layer].maxZoom}
              />
              <FitToPoints positions={fitPositions} />
              {withGps.map((t) => {
                const [lat, lng] = posOf(t);
                return (
                  <Marker
                    key={t.id}
                    position={[lat, lng]}
                    draggable
                    autoPan
                    zIndexOffset={400}
                    icon={assignmentPinIcon({
                      towerId: t.tower_id,
                      teamName: t.assigned_team_name,
                      mapNumber: numbers.get(t.id),
                    })}
                    eventHandlers={{
                      dragend: (e) => handleDragEnd(t, e.target as L.Marker),
                    }}
                  >
                    <LeafletTooltip direction="top" offset={[0, -14]} opacity={1} interactive={false}>
                      <strong>
                        {numbers.get(t.id) != null ? `#${numbers.get(t.id)} · ` : ''}
                        {t.tower_id}
                      </strong>
                      <br />
                      Drag to update GPS
                    </LeafletTooltip>
                  </Marker>
                );
              })}
            </MapContainer>
          )}
          <Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 1000 }}>
            <Tooltip title={layer === 'street' ? 'Satellite' : 'Street map'}>
              <IconButton
                size="small"
                onClick={() => setLayer((v) => (v === 'street' ? 'satellite' : 'street'))}
                sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}
              >
                {layer === 'street' ? <SatelliteAltIcon fontSize="small" /> : <MapIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Stack>
    </Dialog>
  );
}
