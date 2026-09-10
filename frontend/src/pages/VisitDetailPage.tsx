import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../auth/AuthContext';
import ArrowBackIcon from '@mui/icons-material/ArrowBackRounded';
import DeleteIcon from '@mui/icons-material/DeleteRounded';
import GroupsIcon from '@mui/icons-material/GroupsRounded';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdfRounded';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  useAddExtraImage,
  useChoiceLists,
  useClearImageFile,
  useDeleteImage,
  useDeleteVisit,
  useMakePrimaryImage,
  useRetypeImage,
  useSaveAnnotation,
  useUpdateImage,
  useUpdatePosition,
  useUpdateVisit,
  useUploadImage,
  useVisit,
} from '../api/hooks';
import { mediaUrl } from '../api/client';
import type { Position } from '../api/types';
import { KpiTile } from '../components/KpiTile';
import { VisitStatusChip } from '../components/Badges';
import { MapPicker } from '../components/MapPicker';
import { PositionPanel } from '../components/PositionPanel';
import { AddPositionBar } from '../components/AddPositionBar';
import { VisitPhotosSection } from '../components/VisitPhotosSection';
import CellTowerIcon from '@mui/icons-material/CellTowerRounded';
import FactCheckIcon from '@mui/icons-material/FactCheckRounded';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import PendingActionsIcon from '@mui/icons-material/PendingActionsRounded';

// Not part of the workbook's Lists sheet (Thermal mode was free text there) — this is a curated set
// of the modes field crews actually report on radiometric thermal cameras (FLIR/DJI H20T etc.).
const THERMAL_MODE_OPTIONS = [
  'Radiometric',
  'Non-Radiometric (Visual IR)',
  'High Gain',
  'Low Gain',
  'Auto Gain',
  'MSX (Edge Enhancement)',
  'Spot Meter',
  'Isotherm / Area Analysis',
];

export function VisitDetailPage() {
  const { visitId } = useParams();
  const id = Number(visitId);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeamMember = user?.role === 'team_member';
  const { data: visit, isLoading, isError, error: visitError } = useVisit(id);
  const { data: lists } = useChoiceLists();
  const updateVisit = useUpdateVisit();
  const updatePosition = useUpdatePosition(id);
  const uploadImage = useUploadImage(id);
  const updateImage = useUpdateImage(id);
  const clearImageFile = useClearImageFile(id);
  const saveAnnotation = useSaveAnnotation(id);
  const addExtraImage = useAddExtraImage(id);
  const deleteImage = useDeleteImage(id);
  const retypeImage = useRetypeImage(id);
  const makePrimaryImage = useMakePrimaryImage(id);
  const deleteVisit = useDeleteVisit();

  const [headerDraft, setHeaderDraft] = useState<Record<string, unknown> | null>(null);
  // Positions manually revealed this session via "Add position" but that don't have real data yet —
  // isPositionActive() below already covers everything with data, this only plugs the gap between
  // clicking Add and actually filling something in (and lets a mis-click be undone).
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  const header = useMemo(() => ({ ...visit, ...headerDraft }), [visit, headerDraft]);

  if (isError) {
    const status = (visitError as { response?: { status?: number } })?.response?.status;
    return (
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/towers')} sx={{ alignSelf: 'flex-start' }}>
          Back to towers
        </Button>
        <Alert severity={status === 403 ? 'warning' : 'error'}>
          {status === 403
            ? "You don't have access to this visit — team-leader accounts only see their own team's missions."
            : 'Could not load this visit.'}
        </Alert>
      </Stack>
    );
  }

  if (isLoading || !visit || !lists) {
    return <LinearProgress />;
  }

  const saveHeaderField = (field: string, value: unknown) => {
    setHeaderDraft((d) => ({ ...(d || {}), [field]: value }));
  };

  const commitHeader = () => {
    if (headerDraft && Object.keys(headerDraft).length > 0) {
      updateVisit.mutate({ id, payload: headerDraft });
      setHeaderDraft(null);
    }
  };

  const pendingEvidence = visit.positions
    .flatMap((p) => p.images.map((img) => ({ position: p, image: img })))
    .filter(({ image }) => image.evidence_status === 'PENDING CAPTURE' || image.evidence_status === 'RECAPTURE REQUIRED');

  // All 12 canonical (OHL, phase, string) slots always exist server-side (the fixed ID scheme
  // depends on it — see BUILD_PROMPT), but a slot only counts as "real" once it has actual data:
  // a direction set, a screening result recorded, or an uploaded photo. Everything else stays
  // hidden until the inspector explicitly adds it below.
  const isPositionActive = (p: Position) =>
    !!p.direction || p.screening_result !== 'Not inspected' || p.images.some((img) => !!img.file_path);
  const visiblePositions = visit.positions.filter((p) => isPositionActive(p) || addedIds.has(p.id));
  const hiddenIds = new Set(
    visit.positions.filter((p) => !isPositionActive(p) && !addedIds.has(p.id)).map((p) => p.id),
  );

  const handleAddPosition = (position: Position, direction: string) => {
    setAddedIds((prev) => new Set(prev).add(position.id));
    if (direction) {
      updatePosition.mutate({ id: position.id, payload: { direction } });
    }
  };

  const handleRemovePosition = (positionId: number) => {
    setAddedIds((prev) => {
      const next = new Set(prev);
      next.delete(positionId);
      return next;
    });
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(isTeamMember ? '/' : `/towers/${visit.tower_id}`)}>
          {isTeamMember ? 'Back to my missions' : 'Back to tower'}
        </Button>
        <Stack direction="row" spacing={1.5}>
          <Button
            variant="outlined"
            startIcon={<PictureAsPdfIcon />}
            component="a"
            href={mediaUrl(`/api/reports/visits/${id}.pdf`)}
            target="_blank"
            rel="noreferrer"
          >
            Download tower report (PDF)
          </Button>
          {!isTeamMember && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              disabled={deleteVisit.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    'Permanently delete this inspection visit? This removes all its positions, screening results, and images. This cannot be undone.',
                  )
                ) {
                  deleteVisit.mutate(id, { onSuccess: () => navigate(`/towers/${visit.tower_id}`) });
                }
              }}
            >
              Delete visit
            </Button>
          )}
        </Stack>
      </Stack>

      <Box>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {visit.tower?.tower_id} — Field Inspection Visit
          </Typography>
          <VisitStatusChip status={visit.rollup?.visit_status} />
          {visit.team_id && (
            <Chip
              icon={<GroupsIcon />}
              label={`${visit.team_name} — Mission ${visit.mission_seq}`}
              component={RouterLink}
              to={`/teams/${visit.team_id}`}
              clickable
              color="primary"
              variant="outlined"
            />
          )}
        </Stack>
        <Typography color="text.secondary">
          {visit.tower?.voltage} · {visit.tower?.area}
        </Typography>
      </Box>

      {visit.rollup && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label="Installed / Screened" value={`${visit.rollup.screened}/${visit.rollup.installed}`} icon={<CellTowerIcon />} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label="Completion" value={`${visit.rollup.completion_pct}%`} icon={<FactCheckIcon />} color="#3a6f84" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label="Hotspots" value={visit.rollup.hotspots} icon={<LocalFireDepartmentIcon />} color="#d32f2f" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label="Images pending" value={visit.rollup.images_pending} icon={<PendingActionsIcon />} color="#f57c00" />
          </Grid>
        </Grid>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
            Visit header
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                type="date"
                label="Inspection date"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={(header.inspection_date as string) || ''}
                onChange={(e) => saveHeaderField('inspection_date', e.target.value)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label="Inspector"
                fullWidth
                value={(header.inspector_name as string) || ''}
                onChange={(e) => saveHeaderField('inspector_name', e.target.value)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label="Permit / Job No."
                fullWidth
                value={(header.permit_job_no as string) || ''}
                onChange={(e) => saveHeaderField('permit_job_no', e.target.value)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label="Weather / wind"
                fullWidth
                value={(header.weather_wind as string) || ''}
                onChange={(e) => saveHeaderField('weather_wind', e.target.value)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label="Electrical load"
                fullWidth
                value={(header.electrical_load as string) || ''}
                onChange={(e) => saveHeaderField('electrical_load', e.target.value)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label="Camera / drone"
                fullWidth
                value={(header.camera_drone as string) || ''}
                onChange={(e) => saveHeaderField('camera_drone', e.target.value)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                size="small"
                label="Thermal mode"
                fullWidth
                value={(header.thermal_mode as string) || ''}
                onChange={(e) => updateVisit.mutate({ id, payload: { thermal_mode: e.target.value || null } })}
              >
                <MenuItem value="">—</MenuItem>
                {THERMAL_MODE_OPTIONS.map((m) => (
                  <MenuItem key={m} value={m}>
                    {m}
                  </MenuItem>
                ))}
                {header.thermal_mode && !THERMAL_MODE_OPTIONS.includes(header.thermal_mode as string) && (
                  <MenuItem value={header.thermal_mode as string}>{header.thermal_mode as string} (existing)</MenuItem>
                )}
              </TextField>
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField
                size="small"
                type="number"
                label="Emissivity"
                fullWidth
                value={(header.emissivity as number) ?? ''}
                onChange={(e) => saveHeaderField('emissivity', e.target.value ? Number(e.target.value) : null)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField
                size="small"
                type="number"
                label="Reflected temp (°C)"
                fullWidth
                value={(header.reflected_temp as number) ?? ''}
                onChange={(e) => saveHeaderField('reflected_temp', e.target.value ? Number(e.target.value) : null)}
                onBlur={commitHeader}
              />
            </Grid>
          </Grid>

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
            Equipment &amp; environment (official report)
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label="Camera serial no."
                fullWidth
                value={(header.camera_serial_no as string) || ''}
                onChange={(e) => saveHeaderField('camera_serial_no', e.target.value)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label="Calibration certificate no."
                fullWidth
                value={(header.calibration_cert_no as string) || ''}
                onChange={(e) => saveHeaderField('calibration_cert_no', e.target.value)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                type="date"
                label="Calibration due date"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={(header.calibration_due_date as string) || ''}
                onChange={(e) => saveHeaderField('calibration_due_date', e.target.value || null)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                type="number"
                label="Distance to target (m)"
                fullWidth
                value={(header.distance_to_target_m as number) ?? ''}
                onChange={(e) => saveHeaderField('distance_to_target_m', e.target.value ? Number(e.target.value) : null)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                type="number"
                label="Ambient temp (°C)"
                fullWidth
                value={(header.ambient_temp_c as number) ?? ''}
                onChange={(e) => saveHeaderField('ambient_temp_c', e.target.value ? Number(e.target.value) : null)}
                onBlur={commitHeader}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                type="number"
                label="Humidity (%)"
                fullWidth
                value={(header.humidity_pct as number) ?? ''}
                onChange={(e) => saveHeaderField('humidity_pct', e.target.value ? Number(e.target.value) : null)}
                onBlur={commitHeader}
              />
            </Grid>
          </Grid>

          {visit.team_id && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
                Mission timing — {visit.team_name}, Mission {visit.mission_seq}
              </Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField
                    size="small"
                    type="time"
                    label="Start time"
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={(header.start_time as string)?.slice(0, 5) || ''}
                    onChange={(e) => saveHeaderField('start_time', e.target.value || null)}
                    onBlur={commitHeader}
                  />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField
                    size="small"
                    type="time"
                    label="End time"
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={(header.end_time as string)?.slice(0, 5) || ''}
                    onChange={(e) => saveHeaderField('end_time', e.target.value || null)}
                    onBlur={commitHeader}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    select
                    size="small"
                    label="Mission status"
                    fullWidth
                    value={(header.mission_status as string) || 'planned'}
                    onChange={(e) => updateVisit.mutate({ id, payload: { mission_status: e.target.value } })}
                  >
                    <MenuItem value="planned">Planned</MenuItem>
                    <MenuItem value="in_progress">In progress</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                  </TextField>
                </Grid>
              </Grid>
            </>
          )}

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
            Visit GPS — this mission's tower
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            The boxed pin below is {visit.tower?.tower_id || 'this tower'} — starts at the tower's own recorded
            location; drag it (or click the map) only if you need to log exactly where you stood for this visit.
          </Typography>
          <MapPicker
            // Falls back through: this visit's own saved GPS -> the tower's own recorded location, so the
            // map always shows the right tower instead of a blank/generic view when a visit has no GPS yet.
            latitude={(header.latitude as number) ?? visit.latitude ?? visit.tower?.latitude ?? null}
            longitude={(header.longitude as number) ?? visit.longitude ?? visit.tower?.longitude ?? null}
            onChange={(lat, lng) => updateVisit.mutate({ id, payload: { latitude: lat, longitude: lng } })}
            height={320}
            label={visit.tower?.tower_id}
            highlight
          />
        </CardContent>
      </Card>

      {pendingEvidence.length > 0 && (
        <Alert severity="warning">
          Evidence check: {pendingEvidence.length} image(s) still pending across this visit before it can be marked
          "Ready for review".
        </Alert>
      )}

      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
          Inspection positions
        </Typography>
        <Stack spacing={1.5}>
          <AddPositionBar positions={visit.positions} hiddenIds={hiddenIds} lists={lists} onAdd={handleAddPosition} />
          {visiblePositions.length === 0 && (
            <Alert severity="info">
              No positions added yet — use "Add position" above to start recording an insulator string.
            </Alert>
          )}
          {visiblePositions.map((p) => (
            <PositionPanel
              key={p.id}
              position={p}
              lists={lists}
              defaultExpanded
              onUpdate={(payload) => updatePosition.mutate({ id: p.id, payload })}
              onUploadImage={(imageId, file, meta) =>
                uploadImage.mutate({
                  imageId,
                  file,
                  captureDate: meta.captureDate as string | undefined,
                  captureTime: meta.captureTime as string | undefined,
                  latitude: meta.latitude as number | undefined,
                  longitude: meta.longitude as number | undefined,
                })
              }
              onUpdateImage={(imageId, payload) => updateImage.mutate({ id: imageId, payload })}
              onClearImageFile={(imageId) => clearImageFile.mutate(imageId)}
              onSaveAnnotation={async (imageId, blob) => {
                await saveAnnotation.mutateAsync({ imageId, blob });
              }}
              onAddExtraImage={(imageType, file, meta) =>
                addExtraImage.mutate({
                  positionId: p.id,
                  imageType,
                  file,
                  captureDate: meta.captureDate as string | undefined,
                  captureTime: meta.captureTime as string | undefined,
                  latitude: meta.latitude as number | undefined,
                  longitude: meta.longitude as number | undefined,
                })
              }
              onDeleteImage={(imageId) => deleteImage.mutate(imageId)}
              onRetypeImage={(imageId, newType) => retypeImage.mutate({ id: imageId, newType })}
              onMakePrimaryImage={(imageId) => makePrimaryImage.mutate(imageId)}
              annotationSaving={saveAnnotation.isPending}
              onRemove={addedIds.has(p.id) && !isPositionActive(p) ? () => handleRemovePosition(p.id) : undefined}
            />
          ))}
        </Stack>
      </Box>

      <VisitPhotosSection visitId={id} positions={visit.positions} />
    </Stack>
  );
}
