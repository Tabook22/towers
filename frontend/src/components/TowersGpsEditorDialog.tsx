import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Alert,
  AppBar,
  Autocomplete,
  Box,
  Button,
  Dialog,
  IconButton,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/CloseRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import 'leaflet/dist/leaflet.css';
import { TILE_LAYERS, type MapLayer } from './MapPicker';
import { assignmentPinIcon, numberedDotIcon, towerNumbersById } from './towerMapPins';
import { usePatchTowerLocation } from '../api/hooks';
import type { TowerWithStats } from '../api/types';

type SearchHit = {
  id: number;
  label: string;
  tower: TowerWithStats;
  mapNumber: number | null;
};

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

function FlyToTower({
  target,
  nonce,
}: {
  target: [number, number] | null;
  nonce: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.flyTo(target, 18, { duration: 0.7 });
  }, [map, target, nonce]);
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
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<SearchHit | null>(null);
  const [flyNonce, setFlyNonce] = useState(0);
  const patchGps = usePatchTowerLocation();
  const saving = useRef<Set<number>>(new Set());

  const searchOptions: SearchHit[] = useMemo(() => {
    return (towers || []).map((t) => {
      const mapNumber = numbers.get(t.id) ?? null;
      const label = `${mapNumber != null ? `#${mapNumber} · ` : ''}${t.tower_id}${t.area ? ` · ${t.area}` : ''}${
        t.latitude == null ? ' · no GPS' : ''
      }`;
      return { id: t.id, label, tower: t, mapNumber };
    });
  }, [towers, numbers]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return searchOptions.slice(0, 40);
    const asNum = q.replace(/^#/, '');
    const wantNum = /^\d+$/.test(asNum) ? Number(asNum) : null;
    return searchOptions
      .filter((o) => {
        if (wantNum != null && o.mapNumber === wantNum) return true;
        if (o.tower.tower_id.toLowerCase().includes(q)) return true;
        if ((o.tower.area || '').toLowerCase().includes(q)) return true;
        if (o.label.toLowerCase().includes(q)) return true;
        return false;
      })
      .sort((a, b) => {
        if (wantNum != null) {
          const ae = a.mapNumber === wantNum ? 0 : 1;
          const be = b.mapNumber === wantNum ? 0 : 1;
          if (ae !== be) return ae - be;
        }
        return (a.mapNumber ?? 9999) - (b.mapNumber ?? 9999);
      })
      .slice(0, 40);
  }, [query, searchOptions]);

  const goToHit = (hit: SearchHit | null) => {
    setPicked(hit);
    if (!hit) return;
    const t = hit.tower;
    const o = overrides[t.id];
    if (o) {
      setError(null);
      setFlyNonce((n) => n + 1);
      setStatus(`Found ${hit.label}. Drag the highlighted pin.`);
      return;
    }
    if (t.latitude == null || t.longitude == null) {
      setError(`${t.tower_id} has no GPS yet. Open it from the table to drop a pin first.`);
      return;
    }
    setError(null);
    setFlyNonce((n) => n + 1);
    setStatus(`Found ${hit.label}. Drag the highlighted pin.`);
  };

  useEffect(() => {
    if (!open) {
      setOverrides({});
      setStatus(null);
      setError(null);
      setQuery('');
      setPicked(null);
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
  const flyTarget: [number, number] | null = (() => {
    if (!picked) return null;
    const o = overrides[picked.id];
    if (o) return [o.lat, o.lng];
    if (picked.tower.latitude != null && picked.tower.longitude != null) {
      return [picked.tower.latitude, picked.tower.longitude];
    }
    return null;
  })();

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <AppBar sx={{ position: 'relative' }} color="default" elevation={1}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 800 }} variant="h6">
            Move towers on the map
          </Typography>
          <Autocomplete
            sx={{ flex: 1, minWidth: 260, maxWidth: 520, bgcolor: 'background.paper', borderRadius: 1 }}
            options={filteredOptions}
            value={picked}
            inputValue={query}
            onInputChange={(_e, v) => setQuery(v)}
            onChange={(_e, v) => goToHit(v)}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            filterOptions={(opts) => opts}
            noOptionsText="No tower matches that number or name"
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                placeholder="Search number, e.g. 12 or Ashoor-Saada-12"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredOptions.length === 1) {
                    e.preventDefault();
                    goToHit(filteredOptions[0]);
                  }
                }}
              />
            )}
          />
          <Button color="inherit" onClick={onClose} startIcon={<CloseIcon />}>
            Done
          </Button>
        </Toolbar>
      </AppBar>
      <Stack sx={{ height: '100%', minHeight: 0 }}>
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <Typography variant="body2" color="text.secondary">
            Search a tower number, then drag that pin. GPS is saved as soon as you drop it.
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
              <FlyToTower target={flyTarget} nonce={flyNonce} />
              {withGps.map((t) => {
                const [lat, lng] = posOf(t);
                const focused = picked?.id === t.id;
                const n = numbers.get(t.id);
                return (
                  <Marker
                    key={t.id}
                    position={[lat, lng]}
                    draggable
                    autoPan
                    zIndexOffset={focused ? 2500 : 400}
                    icon={
                      focused && n != null
                        ? numberedDotIcon({
                            mapNumber: n,
                            color: t.assigned_team_name ? '#d32f2f' : '#2e7d32',
                            focused: true,
                          })
                        : assignmentPinIcon({
                            towerId: t.tower_id,
                            teamName: t.assigned_team_name,
                            mapNumber: n,
                          })
                    }
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
