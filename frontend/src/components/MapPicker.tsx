import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip as LeafletTooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocationRounded';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreenRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import 'leaflet/dist/leaflet.css';
import { numberedDotIcon, towerNumbersById } from './towerMapPins';

export type MapLayer = 'street' | 'satellite';

export const TILE_LAYERS: Record<MapLayer, { url: string; attribution: string; maxZoom: number }> = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  // Esri World Imagery — free, no API key required (standard "free satellite tiles" choice for Leaflet).
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS community',
    maxZoom: 19,
  },
};

const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// A boxed target marker — a highlighted square ring around a center dot, exactly over the
// coordinate — used wherever a single tower needs to read unambiguously as "this one, right here"
// (a mission's tower, a tower's own detail page) rather than blend in as just another map pin.
const highlightIcon = L.divIcon({
  className: '',
  html: `<div style="position:relative;width:40px;height:40px;">
      <div style="position:absolute;inset:2px;border:3px solid #1976d2;border-radius:6px;background:rgba(25,118,210,0.10);box-shadow:0 0 0 3px rgba(25,118,210,0.18);"></div>
      <div style="position:absolute;top:50%;left:50%;width:12px;height:12px;background:#1976d2;border:2px solid white;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 1px rgba(0,0,0,0.35);"></div>
    </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

interface MapPickerProps {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  onChange?: (lat: number, lng: number) => void;
  height?: number;
  /** Height while expanded. Defaults to roughly 1.8x `height`, capped at 680px. */
  expandedHeight?: number;
  readOnly?: boolean;
  fallbackCenter?: [number, number];
  /** Shown as a small always-visible label above the marker (e.g. the tower ID) — lets a crew
   * confirm at a glance whose location a pin represents, without having to click/hover it. */
  label?: string;
  /** Draws the marker as a highlighted box-around-a-dot instead of a plain pin — use whenever the
   * point is "the tower this screen is about" (a mission's tower, a tower's own page), so it's
   * unmistakable at a glance rather than looking like just another location. */
  highlight?: boolean;
  /** Other catalog towers to draw as numbered context pins (add/edit tower dialog). */
  otherTowers?: {
    id: number;
    tower_id: string;
    area?: string | null;
    latitude: number | null;
    longitude: number | null;
  }[];
  /** Clicking a context pin — used to jump to editing that tower. */
  onSelectOther?: (id: number) => void;
  currentId?: number;
}

function ClickHandler({ onChange }: { onChange?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    },
  });
  return null;
}

function FitToContext({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const key = positions.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|');
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function MapRefBridge({ mapRef }: { mapRef: MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

export function MapPicker({
  latitude,
  longitude,
  onChange,
  height = 360,
  expandedHeight,
  readOnly = false,
  label,
  highlight = false,
  otherTowers = [],
  onSelectOther,
  currentId,
  // Salalah, Oman (17.01972°N 54.08972°E per Wikipedia) — the real city at the center of the
  // Dhofar/"Dufar" governorate this app's demo data is set in. Was wrongly defaulting to a
  // generic Abu Dhabi-area point before.
  fallbackCenter = [17.01972, 54.08972],
}: MapPickerProps) {
  const hasPoint = typeof latitude === 'number' && typeof longitude === 'number';
  const contextPts = otherTowers.filter((t) => t.latitude != null && t.longitude != null);
  const mapNumbers = towerNumbersById(
    contextPts.concat(
      currentId != null && hasPoint
        ? [{ id: currentId, tower_id: label || '', latitude: latitude as number, longitude: longitude as number }]
        : [],
    ),
  );
  const fitPositions = useMemo<[number, number][]>(() => {
    const pts = contextPts.map((t) => [t.latitude as number, t.longitude as number] as [number, number]);
    if (hasPoint) pts.push([latitude as number, longitude as number]);
    return pts;
    // Fit to neighbors + the starting pin, not every drag of the current marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextPts.map((t) => t.id).join(',')]);
  const center = useMemo<[number, number]>(
    () => (hasPoint ? [latitude as number, longitude as number] : contextPts[0] ? [contextPts[0].latitude as number, contextPts[0].longitude as number] : fallbackCenter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const mapRef = useRef<L.Map | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [layer, setLayer] = useState<MapLayer>('street');
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const currentHeight = expanded ? (expandedHeight ?? Math.min(680, Math.round(height * 1.8))) : height;

  useEffect(() => {
    // Let the container finish resizing before Leaflet recalculates its tile grid,
    // otherwise the map renders with stale/blank tiles at the new size.
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 220);
    return () => window.clearTimeout(id);
  }, [currentHeight]);

  const handleLocate = () => {
    if (!navigator.geolocation) {
      setLocateError('Geolocation is not supported by this browser.');
      return;
    }
    setLocateError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setLocating(false);
        onChange?.(lat, lng);
        mapRef.current?.flyTo([lat, lng], 16);
      },
      (err) => {
        setLocating(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED ? 'Location permission denied.' : 'Could not get your current location.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
      {/* react-leaflet's MapContainer only applies `style` on its first render (it's captured once via
          useState internally), so the resizable height lives on this plain div instead — using a native
          inline style here (rather than MUI's sx) so there's no ambiguity about when it's applied — and
          MapContainer just fills it. */}
      <div style={{ position: 'relative', height: currentHeight, width: '100%', transition: 'height 0.2s ease' }}>
        <MapContainer
          center={center}
          zoom={hasPoint ? 15 : 11}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution={TILE_LAYERS[layer].attribution}
            url={TILE_LAYERS[layer].url}
            maxZoom={TILE_LAYERS[layer].maxZoom}
          />
          <MapRefBridge mapRef={mapRef} />
          <FitToContext positions={fitPositions.length ? fitPositions : hasPoint ? [[latitude as number, longitude as number]] : []} />
          {!readOnly && <ClickHandler onChange={onChange} />}
          {contextPts.map((t) => {
            const n = mapNumbers.get(t.id);
            if (n == null) return null;
            return (
              <Marker
                key={t.id}
                position={[t.latitude as number, t.longitude as number]}
                icon={numberedDotIcon({ mapNumber: n, color: '#546e7a' })}
                interactive
                bubblingMouseEvents={false}
                zIndexOffset={100}
                eventHandlers={
                  onSelectOther
                    ? {
                        click: () => onSelectOther(t.id),
                      }
                    : undefined
                }
              >
                <LeafletTooltip direction="top" offset={[0, -12]} opacity={1} interactive={false}>
                  <strong>
                    {n != null ? `#${n} · ` : ''}
                    {t.tower_id}
                  </strong>
                  {onSelectOther ? (
                    <>
                      <br />
                      Click to edit this tower
                    </>
                  ) : null}
                </LeafletTooltip>
              </Marker>
            );
          })}
          {hasPoint && (
            <Marker
              position={[latitude as number, longitude as number]}
              icon={highlight ? highlightIcon : defaultIcon}
              draggable={!readOnly}
              zIndexOffset={800}
              eventHandlers={
                readOnly
                  ? undefined
                  : {
                      dragend: (e) => {
                        const m = e.target as L.Marker;
                        const pos = m.getLatLng();
                        onChange?.(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
                      },
                    }
              }
            >
              {label && (
                <LeafletTooltip
                  permanent
                  direction="top"
                  offset={highlight ? [0, -22] : [0, -38]}
                  opacity={1}
                  className="map-picker-label"
                >
                  {label}
                </LeafletTooltip>
              )}
            </Marker>
          )}
        </MapContainer>
        <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {!readOnly && (
            <Tooltip title="Use my current location">
              <span>
                <IconButton
                  size="small"
                  onClick={handleLocate}
                  disabled={locating}
                  sx={{ bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}
                >
                  <MyLocationIcon fontSize="small" color={locating ? 'disabled' : 'primary'} />
                </IconButton>
              </span>
            </Tooltip>
          )}
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
      {!readOnly && (
        <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'grey.100' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {contextPts.length
              ? 'Numbered pins are towers already in the catalog. Drag this marker (or click the map) to place the one you are editing. Click a numbered pin to switch to that tower. '
              : 'Click the map to drop a pin, drag the marker to fine-tune, or use the locate button. '}
            Lat: {hasPoint ? latitude!.toFixed(6) : '-'}, Lng: {hasPoint ? longitude!.toFixed(6) : '-'}
          </Typography>
          {locateError && (
            <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.25 }}>
              {locateError}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
