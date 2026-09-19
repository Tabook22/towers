import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip as LeafletTooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Box, Chip, Dialog, DialogContent, DialogTitle, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAltRounded';
import MapIcon from '@mui/icons-material/MapRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import 'leaflet/dist/leaflet.css';
import { DEFAULT_MAP_LAYER, TILE_LAYERS, type MapLayer } from './MapPicker';
import { splitTrailSegments } from '../utils/gpsTrail';
import type { LiveTeamMember, TeamJobMapTower, TrailPoint, UserTrail } from '../api/types';
import { FREE_TOWER_COLOR, assignmentPinIcon, colorForTeam, extractTowerNumber, numberedDotIcon, teamsPresent, towerNumbersById } from './towerMapPins';

const TOWER_COLORS: Record<string, string> = {
  completed: '#2e7d32',
  in_progress: '#1976d2',
  pending: '#9e9e9e',
};

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

function OpenPopupOnMapClick({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  useMapEvents({
    click: () => {
      if (enabled) onOpen();
    },
  });
  return null;
}

function InvalidateSize({ sizeKey }: { sizeKey: string }) {
  const map = useMap();
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 80);
    return () => window.clearTimeout(id);
  }, [map, sizeKey]);
  return null;
}

export function TeamSiteMap({
  towers,
  liveMembers,
  trails,
  myLocation,
  myLabel = 'You',
  height = 380,
  plannedIds,
  freeTowers,
  catalogTowers,
  onFreeTowerClick,
  onCatalogTowerClick,
  claiming,
}: {
  towers?: TeamJobMapTower[];
  liveMembers?: LiveTeamMember[];
  trails?: UserTrail[];
  myLocation?: { latitude: number; longitude: number } | null;
  myLabel?: string;
  height?: number;
  plannedIds?: number[];
  freeTowers?: { id: number; tower_id: string; area: string | null; latitude: number | null; longitude: number | null }[];
  catalogTowers?: {
    id: number;
    tower_id: string;
    area: string | null;
    latitude: number | null;
    longitude: number | null;
    assigned_team_id: number | null;
    assigned_team_name: string | null;
    latest_visit_mission_status?: string | null;
  }[];
  onFreeTowerClick?: (towerId: number) => void;
  onCatalogTowerClick?: (tower: {
    id: number;
    tower_id: string;
    area: string | null;
    assigned_team_id: number | null;
    assigned_team_name: string | null;
  }) => void;
  claiming?: boolean;
}) {
  const planned = new Set(plannedIds || []);
  const hasPlan = planned.size > 0;
  const towerPts = (towers || []).filter((t) => t.latitude != null && t.longitude != null);
  const livePts = (liveMembers || []).filter(
    (m): m is LiveTeamMember & { latitude: number; longitude: number } =>
      m.latitude != null && m.longitude != null,
  );
  const trailPts = (trails || []).flatMap((t) => t.points);
  const mapTowers = hasPlan ? towerPts.filter((t) => planned.has(t.id)) : towerPts;
  const assignedIds = new Set((towers || []).map((t) => t.id));
  const freePts = (freeTowers || []).filter(
    (t) => t.latitude != null && t.longitude != null && !assignedIds.has(t.id),
  );
  const catalogPts = (catalogTowers || []).filter((t) => t.latitude != null && t.longitude != null);
  const showCatalog = catalogPts.length > 0;
  const canClaim = Boolean(onCatalogTowerClick || onFreeTowerClick);
  const mapNumbers = towerNumbersById(showCatalog ? catalogPts : [...mapTowers, ...freePts]);
  const positions: [number, number][] = [
    ...mapTowers.map((t) => [t.latitude as number, t.longitude as number] as [number, number]),
    ...livePts.map((m) => [m.latitude, m.longitude] as [number, number]),
    ...trailPts.map((p) => [p.latitude, p.longitude] as [number, number]),
    ...(myLocation ? [[myLocation.latitude, myLocation.longitude] as [number, number]] : []),
    ...(mapTowers.length === 0
      ? (catalogPts.length
          ? catalogPts.map((t) => [t.latitude as number, t.longitude as number] as [number, number])
          : freePts.map((t) => [t.latitude as number, t.longitude as number] as [number, number]))
      : []),
  ];
  const center: [number, number] = positions[0] || [17.01972, 54.08972];
  const mapRef = useRef<L.Map | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupW, setPopupW] = useState(80);
  const [popupH, setPopupH] = useState(80);
  const resizeRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
    edge: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  } | null>(null);
  const [layer, setLayer] = useState<MapLayer>(DEFAULT_MAP_LAYER);
  const h = height;

  const clampPct = (n: number) => Math.min(98, Math.max(40, Math.round(n)));
  const onResizePointerDown =
    (edge: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw') => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      resizeRef.current = { x: e.clientX, y: e.clientY, w: popupW, h: popupH, edge };
    };
  const onResizePointerMove = (e: React.PointerEvent) => {
    const d = resizeRef.current;
    if (!d) return;
    const dw = ((e.clientX - d.x) / window.innerWidth) * 100;
    const dh = ((e.clientY - d.y) / window.innerHeight) * 100;
    let w = d.w;
    let hPct = d.h;
    if (d.edge === 'e' || d.edge === 'ne' || d.edge === 'se') w = d.w + dw;
    if (d.edge === 'w' || d.edge === 'nw' || d.edge === 'sw') w = d.w - dw;
    if (d.edge === 's' || d.edge === 'se' || d.edge === 'sw') hPct = d.h + dh;
    if (d.edge === 'n' || d.edge === 'ne' || d.edge === 'nw') hPct = d.h - dh;
    setPopupW(clampPct(w));
    setPopupH(clampPct(hPct));
  };
  const onResizePointerUp = () => {
    resizeRef.current = null;
  };
  const resizeHandle = (
    edge: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
    sx: Record<string, string | number>,
  ) => (
    <Box
      key={edge}
      onPointerDown={onResizePointerDown(edge)}
      onPointerMove={onResizePointerMove}
      onPointerUp={onResizePointerUp}
      onPointerCancel={onResizePointerUp}
      sx={{
        position: 'absolute',
        zIndex: 2000,
        bgcolor: 'transparent',
        '&:hover': { bgcolor: 'rgba(13,71,92,0.18)' },
        ...sx,
      }}
      title="Drag to resize"
    />
  );

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
        {showCatalog || canClaim ? (
          <>
            <Chip size="small" label="Free" sx={{ bgcolor: FREE_TOWER_COLOR, color: '#fff' }} />
            {teamsPresent(catalogPts).map((t) => (
              <Chip key={t.id} size="small" label={t.name} sx={{ bgcolor: colorForTeam(t.id), color: '#fff' }} />
            ))}
            <Chip
              size="small"
              icon={<CheckRoundedIcon sx={{ color: '#fff !important', fontSize: 14 }} />}
              label="Inspection completed"
              sx={{ bgcolor: '#2e7d32', color: '#fff' }}
            />
          </>
        ) : (
          <>
            <Chip size="small" label="Number + Tower ID" variant="outlined" />
            <Chip size="small" label="Tower done" sx={{ bgcolor: '#2e7d32', color: '#fff' }} />
            <Chip size="small" label="In progress" sx={{ bgcolor: '#1976d2', color: '#fff' }} />
            <Chip size="small" label="Not started" sx={{ bgcolor: '#9e9e9e', color: '#fff' }} />
          </>
        )}
        {hasPlan && <Chip size="small" color="primary" label={`${planned.size} tonight`} />}
      </Stack>
      <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
        <div style={{ position: 'relative', height: h, width: '100%', transition: 'height 0.2s ease' }}>
          <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer attribution={TILE_LAYERS[layer].attribution} url={TILE_LAYERS[layer].url} maxZoom={TILE_LAYERS[layer].maxZoom} />
            <MapRefBridge mapRef={mapRef} />
            <OpenPopupOnMapClick enabled={!popupOpen} onOpen={() => setPopupOpen(true)} />
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
            {showCatalog
              ? catalogPts.map((t) => {
                  const free = t.assigned_team_id == null;
                  const completed = t.latest_visit_mission_status === 'completed';
                  return (
                    <Marker
                      key={`cat-${t.id}`}
                      position={[t.latitude as number, t.longitude as number]}
                      icon={assignmentPinIcon({
                        towerId: t.tower_id,
                        teamId: t.assigned_team_id,
                        teamName: t.assigned_team_name,
                        mapNumber: mapNumbers.get(t.id),
                        completed,
                      })}
                      interactive
                      bubblingMouseEvents={false}
                      zIndexOffset={free ? 500 : 200}
                      eventHandlers={
                        canClaim
                          ? {
                              click: () => {
                                if (claiming) return;
                                if (onCatalogTowerClick) onCatalogTowerClick(t);
                                else if (free) onFreeTowerClick?.(t.id);
                              },
                            }
                          : undefined
                      }
                    >
                      <LeafletTooltip direction="top" offset={[0, -14]} opacity={1} interactive={false}>
                        <strong>
                          {mapNumbers.get(t.id) != null ? `#${mapNumbers.get(t.id)} · ` : ''}
                          {t.tower_id}
                        </strong>
                        <br />
                        {t.area || '—'}
                        <br />
                        {free
                          ? 'Free — click to assign to this team'
                          : `Assigned to ${t.assigned_team_name || 'a team'} — click to unassign`}
                        {completed && (
                          <>
                            <br />
                            ✓ Inspection completed
                          </>
                        )}
                      </LeafletTooltip>
                    </Marker>
                  );
                })
              : mapTowers.map((t) => (
                  <Marker
                    key={`tw-${t.id}`}
                    position={[t.latitude as number, t.longitude as number]}
                    icon={numberedDotIcon({
                      towerId: t.tower_id,
                      color: TOWER_COLORS[t.status] || '#9e9e9e',
                      showIdLabel: true,
                    })}
                    interactive
                    bubblingMouseEvents={false}
                    zIndexOffset={300}
                  >
                    <LeafletTooltip direction="top" offset={[0, -14]} opacity={1} interactive={false}>
                      <strong>
                        {extractTowerNumber(t.tower_id) != null ? `#${extractTowerNumber(t.tower_id)} · ` : ''}
                        {t.tower_id}
                      </strong>
                      <br />
                      {t.area || ''}
                      <br />
                      {t.status === 'completed' ? 'Completed' : t.status === 'in_progress' ? 'In progress' : 'Not started'}
                    </LeafletTooltip>
                  </Marker>
                ))}
            {!showCatalog &&
              canClaim &&
              freePts.map((t) => (
                <Marker
                  key={`free-${t.id}`}
                  position={[t.latitude as number, t.longitude as number]}
                  icon={assignmentPinIcon({
                    towerId: t.tower_id,
                    teamName: null,
                  })}
                  interactive
                  bubblingMouseEvents={false}
                  zIndexOffset={500}
                  eventHandlers={{
                    click: () => {
                      if (!claiming) onFreeTowerClick?.(t.id);
                    },
                  }}
                >
                  <LeafletTooltip direction="top" offset={[0, -14]} opacity={1} interactive={false}>
                    <strong>{t.tower_id}</strong>
                    <br />
                    {t.area || '—'}
                    <br />
                    <em>Click to assign to this team</em>
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
            <Tooltip title="Open large map">
              <IconButton
                size="small"
                onClick={() => setPopupOpen(true)}
                sx={{ bgcolor: 'white', '&:hover': { bgcolor: 'grey.100' } }}
              >
                <OpenInFullIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </div>
      </Box>

      <Dialog
        open={popupOpen}
        onClose={() => setPopupOpen(false)}
        maxWidth={false}
        slotProps={{
          paper: {
            sx: {
              width: `${popupW}vw`,
              height: `${popupH}vh`,
              maxWidth: '98vw',
              m: 0,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              overflow: 'hidden',
            },
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1, py: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 800, flex: 1 }}>Site map</Typography>
          <TextField
            size="small"
            type="number"
            label="Width %"
            value={popupW}
            onChange={(e) => setPopupW(clampPct(Number(e.target.value) || 80))}
            slotProps={{ htmlInput: { min: 40, max: 98 } }}
            sx={{ width: 110 }}
          />
          <TextField
            size="small"
            type="number"
            label="Height %"
            value={popupH}
            onChange={(e) => setPopupH(clampPct(Number(e.target.value) || 80))}
            slotProps={{ htmlInput: { min: 40, max: 98 } }}
            sx={{ width: 110 }}
          />
          <Tooltip title={layer === 'street' ? 'Satellite' : 'Map'}>
            <IconButton size="small" onClick={() => setLayer((l) => (l === 'street' ? 'satellite' : 'street'))}>
              {layer === 'street' ? <SatelliteAltIcon fontSize="small" /> : <MapIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <IconButton onClick={() => setPopupOpen(false)} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, flex: 1, minHeight: 0, position: 'relative' }}>
          <MapContainer
            key="site-map-popup"
            center={center}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer attribution={TILE_LAYERS[layer].attribution} url={TILE_LAYERS[layer].url} maxZoom={TILE_LAYERS[layer].maxZoom} />
            <InvalidateSize sizeKey={`${popupW}x${popupH}`} />
            <FitToPoints positions={positions} />
            {(trails || []).flatMap((trail) =>
              splitTrailSegments(trail.points as TrailPoint[]).map((pts, i) => (
                <Polyline
                  key={`p-${trail.user_id}-${i}`}
                  positions={pts}
                  pathOptions={{ color: '#2e7d32', weight: 5, opacity: 0.9 }}
                />
              )),
            )}
            {showCatalog
              ? catalogPts.map((t) => {
                  const free = t.assigned_team_id == null;
                  const completed = t.latest_visit_mission_status === 'completed';
                  return (
                    <Marker
                      key={`p-cat-${t.id}`}
                      position={[t.latitude as number, t.longitude as number]}
                      icon={assignmentPinIcon({
                        towerId: t.tower_id,
                        teamId: t.assigned_team_id,
                        teamName: t.assigned_team_name,
                        mapNumber: mapNumbers.get(t.id),
                        completed,
                      })}
                      interactive
                      bubblingMouseEvents={false}
                      zIndexOffset={free ? 500 : 200}
                      eventHandlers={
                        canClaim
                          ? {
                              click: () => {
                                if (claiming) return;
                                if (onCatalogTowerClick) onCatalogTowerClick(t);
                                else if (free) onFreeTowerClick?.(t.id);
                              },
                            }
                          : undefined
                      }
                    >
                      <LeafletTooltip direction="top" offset={[0, -14]} opacity={1} interactive={false}>
                        <strong>
                          {mapNumbers.get(t.id) != null ? `#${mapNumbers.get(t.id)} · ` : ''}
                          {t.tower_id}
                        </strong>
                        <br />
                        {t.area || '—'}
                        <br />
                        {free
                          ? 'Free — click to assign to this team'
                          : `Assigned to ${t.assigned_team_name || 'a team'} — click to unassign`}
                        {completed && (
                          <>
                            <br />
                            ✓ Inspection completed
                          </>
                        )}
                      </LeafletTooltip>
                    </Marker>
                  );
                })
              : mapTowers.map((t) => (
                  <Marker
                    key={`p-tw-${t.id}`}
                    position={[t.latitude as number, t.longitude as number]}
                    icon={numberedDotIcon({
                      towerId: t.tower_id,
                      color: TOWER_COLORS[t.status] || '#9e9e9e',
                      showIdLabel: true,
                    })}
                    interactive
                    bubblingMouseEvents={false}
                    zIndexOffset={300}
                  >
                    <LeafletTooltip direction="top" offset={[0, -14]} opacity={1} interactive={false}>
                      <strong>
                        {extractTowerNumber(t.tower_id) != null ? `#${extractTowerNumber(t.tower_id)} · ` : ''}
                        {t.tower_id}
                      </strong>
                      <br />
                      {t.area || ''}
                    </LeafletTooltip>
                  </Marker>
                ))}
            {livePts.map((m) => (
              <Marker
                key={`p-lv-${m.user_id}`}
                position={[m.latitude, m.longitude]}
                icon={crewDot(m.is_stale ? '#90a4ae' : '#43a047')}
                zIndexOffset={600}
              >
                <LeafletTooltip direction="top" offset={[0, -10]} opacity={1}>
                  <strong>{m.full_name || m.username}</strong>
                </LeafletTooltip>
              </Marker>
            ))}
            {myLocation && (
              <Marker position={[myLocation.latitude, myLocation.longitude]} icon={youIcon()} zIndexOffset={1200}>
                <LeafletTooltip direction="top" offset={[0, -12]} opacity={1} permanent>
                  <strong>{myLabel}</strong>
                </LeafletTooltip>
              </Marker>
            )}
          </MapContainer>
        </DialogContent>
        {resizeHandle('n', { top: 0, left: 12, right: 12, height: 10, cursor: 'ns-resize' })}
        {resizeHandle('s', { bottom: 0, left: 12, right: 12, height: 10, cursor: 'ns-resize' })}
        {resizeHandle('e', { top: 12, bottom: 12, right: 0, width: 10, cursor: 'ew-resize' })}
        {resizeHandle('w', { top: 12, bottom: 12, left: 0, width: 10, cursor: 'ew-resize' })}
        {resizeHandle('ne', { top: 0, right: 0, width: 16, height: 16, cursor: 'nesw-resize' })}
        {resizeHandle('nw', { top: 0, left: 0, width: 16, height: 16, cursor: 'nwse-resize' })}
        {resizeHandle('se', { bottom: 0, right: 0, width: 18, height: 18, cursor: 'nwse-resize' })}
        {resizeHandle('sw', { bottom: 0, left: 0, width: 16, height: 16, cursor: 'nesw-resize' })}
      </Dialog>
    </Box>
  );
}
