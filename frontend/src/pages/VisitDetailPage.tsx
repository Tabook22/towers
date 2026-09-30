import { tr, useLanguage, locale } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
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
import { useQueryClient } from '@tanstack/react-query';
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
  useDeletePosition,
  useDeletePositionVoiceNote,
  useDeleteVisit,
  useMakePrimaryImage,
  useRetypeImage,
  useSaveAnnotation,
  useTranscribePositionVoiceNote,
  useUpdateImage,
  useUploadImage,
  useVisit,
} from '../api/hooks';
import { mediaUrl } from '../api/client';
import type { Position, PositionSlot } from '../api/types';
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
import { positionLabel } from '../utils/positionChanges';
import { VisitEntryToolbar } from '../components/VisitEntryToolbar';
import { useVisitEntry } from '../api/visitEntry';
import { addEntryPosition, entryHasChanges, entryPositions, prepareEntryLayout } from '../utils/visitEntry';
import { VisitEquipmentPreset } from '../components/VisitEquipmentPreset';
import { mergePositionDraft, type PositionDrafts } from '../utils/visitWorkflow';

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
  useLanguage();
  const { visitId } = useParams();
  return <VisitDetailWorkspace key={visitId} />;
}

function VisitDetailWorkspace() {
  useLanguage();
  const { visitId } = useParams();
  const id = Number(visitId);
  const queryClient=useQueryClient();
  useEffect(()=>{
    if(!('BroadcastChannel' in window))return;
    const channel=new BroadcastChannel('thermal-inspection-saved');
    channel.onmessage=()=>{void queryClient.invalidateQueries({queryKey:['visit',id]})};
    return()=>channel.close();
  },[id,queryClient]);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeamMember = user?.role === 'team_member';
  const { data: visit, isLoading, isError, error: visitError } = useVisit(id);
  const { data: lists } = useChoiceLists();
  const deletePosition = useDeletePosition(id);
  const uploadImage = useUploadImage(id);
  const updateImage = useUpdateImage(id);
  const clearImageFile = useClearImageFile(id);
  const saveAnnotation = useSaveAnnotation(id);
  const addExtraImage = useAddExtraImage(id);
  const deleteImage = useDeleteImage(id);
  const retypeImage = useRetypeImage(id);
  const makePrimaryImage = useMakePrimaryImage(id);
  const deleteVisit = useDeleteVisit();
  const transcribeVoiceNote = useTranscribePositionVoiceNote(id);
  const deleteVoiceNote = useDeletePositionVoiceNote(id);

  const working = useVisitEntry(id, user?.username || '');
  const { entry } = working;
  const drafts = entry.drafts;
  const headerDraft = entry.headerDraft;
  const setDrafts = (value: PositionDrafts | ((current: PositionDrafts) => PositionDrafts)) => working.change(current => ({ ...current, drafts: typeof value === 'function' ? value(current.drafts) : value }));
  const [receipt, setReceipt] = useState<{ title: string; message: string; time: string } | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [pendingVoice, setPendingVoice] = useState<{ position: Position; file: File; token: string; duration: number } | null>(null);
  const uploadVoice = async (recording: NonNullable<typeof pendingVoice>) => {
    setPendingVoice(recording); setUploadBusy(true); setVoiceError('');
    try {
      await working.upload(recording.position, 'Voice note', recording.file, recording.token, recording.duration);
      setPendingVoice(null); setUploadBusy(false);
    } catch {
      setVoiceError(tr("The recording is retained on this page. Retry before leaving; refreshing would lose the unsent recording."));
    }
  };
  const batchSaving = working.busy;
  const pendingDraftImages = working.images.filter(i => !entry.excludedImages.includes(i.id));
  const hasDraft = entryHasChanges(entry) || pendingDraftImages.length > 0;
  useEffect(() => {
    if (!uploadBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploadBusy]);
  const confirmSaved = (title: string, message: string) => {
    setReceipt({ title, message, time: new Date().toLocaleString(locale()) });

  };
  const header = useMemo(() => ({ ...visit, ...headerDraft }), [visit, headerDraft]);

  if (isError) {
    const status = (visitError as { response?: { status?: number } })?.response?.status;
    return (
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/towers')} sx={{ alignSelf: 'flex-start' }}>{tr("Back to towers")}</Button>
        <Alert severity={status === 403 ? 'warning' : 'error'}>
          {status === 403 ? tr("You don't have access to this visit — team-leader accounts only see their own team's missions.") : tr("Could not load this visit.")}
        </Alert>
      </Stack>
    );
  }

  if (isLoading || !visit || !lists || !working.ready) {
    return <Stack spacing={2}><LinearProgress />{working.error && <Alert severity="warning">{tr(working.error)}<Button onClick={() => void working.reload()}>{tr("Retry loading draft")}</Button></Alert>}</Stack>;
  }

  const saveHeaderFields = (values: Record<string, unknown>) => working.change(current => {
    const before = current.headerBefore || visit;
    const changes = { ...(current.headerDraft || {}), ...values };
    for (const key of Object.keys(changes)) if ((changes[key] ?? '') === (before[key as keyof typeof before] ?? '')) delete changes[key];
    return { ...current, headerBefore: before, headerDraft: Object.keys(changes).length ? changes : null };
  });
  const saveHeaderField = (field: string, value: unknown) => saveHeaderFields({ [field]: value });
  const pendingEvidence = visit.positions.filter(p => p.in_scope !== false)
    .flatMap((p) => p.images.map((img) => ({ position: p, image: img })))
    .filter(({ image }) => image.evidence_status === 'PENDING CAPTURE' || image.evidence_status === 'RECAPTURE REQUIRED');

  // Visits start with 12 canonical slots; edited/deleted slots can be added again.
  // A slot only counts as "real" once it has actual data:
  // a direction set, a screening result recorded, an uploaded photo, or a voice note recorded for
  // it. Everything else stays hidden until the inspector explicitly adds it below.
  const isPositionActive = (p: Position) =>
    !!p.mount_type || !!p.string_count || !!p.inspector_notes ||
    !!p.direction ||
    p.screening_result !== 'Not inspected' ||
    p.images.some((img) => !!img.file_path) ||
    !!p.voice_note_path;
  const allPositions = entryPositions(visit, entry);
  const visiblePositions = allPositions.filter(p => p.in_scope !== false && (isPositionActive(p) || !!drafts[p.id] || p.id < 0));
  const hiddenIds = new Set(allPositions.filter(p => !visiblePositions.some(v => v.id === p.id)).map(p => p.id));
  const addSlot = (slot: PositionSlot) => {
    const next = addEntryPosition(visit, entry, slot);
    working.change(next);
    const added = entryPositions(visit, next).find(p => p.ohl === slot.ohl && p.phase === slot.phase && p.string === slot.string && p.direction === slot.direction);
    setSelectedPositionId(added?.id || null);
  };
  const handleAddPosition = async (position: Position, direction: string, mountType: string, stringCount: string) => {
    addSlot({ ohl: position.ohl, phase: position.phase, string: position.string, direction, mount_type: mountType, string_count: stringCount });
  };
  const handleCreatePosition = async (ohl: string, phase: string, string_: string, direction: string, mountType: string, stringCount: string) => {
    addSlot({ ohl, phase, string: string_, direction, mount_type: mountType, string_count: stringCount });
  };
  const focusedPosition = visiblePositions.find(p => p.id === selectedPositionId) || visiblePositions[0];
  const focusedIndex = visiblePositions.findIndex(p => p.id === focusedPosition?.id);

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => {
            if (uploadBusy && !window.confirm(tr("An upload is still pending. Leave this page?"))) return;
            navigate(visit.team_id ? `/teams/${visit.team_id}` : `/towers/${visit.tower_id}`);
          }}
        >
          {visit.team_id ? tr("Back to team") : tr("Back to tower")}
        </Button>
        <Stack direction="row" spacing={1.5}>
          <Button
            variant="outlined"
            startIcon={<PictureAsPdfIcon />}
            disabled={hasDraft || uploadBusy || working.busy}
            component="a"
            href={mediaUrl(`/api/reports/visits/${id}.pdf`)}
            target="_blank"
            rel="noreferrer"
          >{tr("Download tower report (PDF)")}</Button>
          {!isTeamMember && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              disabled={deleteVisit.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    tr("Permanently delete this inspection visit? This removes all its positions, screening results, and images. This cannot be undone."),
                  )
                ) {
                  deleteVisit.mutate(id, { onSuccess: () => navigate(`/towers/${visit.tower_id}`) });
                }
              }}
            >{tr("Delete visit")}</Button>
          )}
        </Stack>
      </Stack>

      <Box>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {visit.tower?.tower_id}{tr(" — Field Inspection Visit")}</Typography>
          <VisitStatusChip status={visit.rollup?.visit_status} />
          {visit.team_id && (
            <Chip
              icon={<GroupsIcon />}
              label={visit.mission_seq == null ? visit.team_name : tr("{0} — Mission {1}", [visit.team_name, visit.mission_seq])}
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
            <KpiTile label={tr("Screened / Installed")} value={`${visit.rollup.screened}/${visit.rollup.installed}`} icon={<CellTowerIcon />} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label={tr("Completion")} value={`${visit.rollup.completion_pct}%`} icon={<FactCheckIcon />} color="#3a6f84" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label={tr("Hotspots")} value={visit.rollup.hotspots} icon={<LocalFireDepartmentIcon />} color="#d32f2f" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label={tr("Images pending")} value={visit.rollup.images_pending} icon={<PendingActionsIcon />} color="#f57c00" />
          </Grid>
        </Grid>
      )}

      <Card component="details">
        <Box component="summary" sx={{ p: 2, cursor: 'pointer', fontWeight: 700 }}>{tr("Visit details · ")}{header.inspection_date as string || tr("Date not set")} · {header.inspector_name as string || tr("Set inspector and equipment")}</Box>
        <CardContent component="fieldset" disabled={working.busy || uploadBusy || working.uncertain} sx={{ border: 0, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>{tr("Visit header")}</Typography>
          <VisitEquipmentPreset visit={visit} userId={String(user?.id || user?.username)} inspectorName={user?.full_name || user?.username || ''}
            onApply={async payload => saveHeaderFields(payload)} />
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                type="date"
                label={tr("Inspection date")}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={(header.inspection_date as string) || ''}
                onChange={(e) => saveHeaderField('inspection_date', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label={tr("Inspector")}
                fullWidth
                value={(header.inspector_name as string) || ''}
                onChange={(e) => saveHeaderField('inspector_name', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label={tr("Permit / Job No.")}
                fullWidth
                value={(header.permit_job_no as string) || ''}
                onChange={(e) => saveHeaderField('permit_job_no', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label={tr("Weather / wind")}
                fullWidth
                value={(header.weather_wind as string) || ''}
                onChange={(e) => saveHeaderField('weather_wind', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label={tr("Electrical load")}
                fullWidth
                value={(header.electrical_load as string) || ''}
                onChange={(e) => saveHeaderField('electrical_load', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label={tr("Camera / drone")}
                fullWidth
                value={(header.camera_drone as string) || ''}
                onChange={(e) => saveHeaderField('camera_drone', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                size="small"
                label={tr("Thermal mode")}
                fullWidth
                value={(header.thermal_mode as string) || ''}
                onChange={(e) => saveHeaderField('thermal_mode', e.target.value || null)}
              >
                <MenuItem value="">—</MenuItem>
                {THERMAL_MODE_OPTIONS.map((m) => (
                  <MenuItem key={m} value={m}>
                    {tr(m)}
                  </MenuItem>
                ))}
                {header.thermal_mode && !THERMAL_MODE_OPTIONS.includes(header.thermal_mode as string) && (
                  <MenuItem value={header.thermal_mode as string}>{header.thermal_mode as string}{tr(" (existing)")}</MenuItem>
                )}
              </TextField>
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField
                size="small"
                type="number"
                label={tr("Emissivity")}
                fullWidth
                value={(header.emissivity as number) ?? ''}
                onChange={(e) => saveHeaderField('emissivity', e.target.value ? Number(e.target.value) : null)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField
                size="small"
                type="number"
                label={tr("Reflected temp (°C)")}
                fullWidth
                value={(header.reflected_temp as number) ?? ''}
                onChange={(e) => saveHeaderField('reflected_temp', e.target.value ? Number(e.target.value) : null)}
              />
            </Grid>
          </Grid>

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>{tr("Equipment & environment (official report)")}</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label={tr("Camera serial no.")}
                fullWidth
                value={(header.camera_serial_no as string) || ''}
                onChange={(e) => saveHeaderField('camera_serial_no', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                label={tr("Calibration certificate no.")}
                fullWidth
                value={(header.calibration_cert_no as string) || ''}
                onChange={(e) => saveHeaderField('calibration_cert_no', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                type="date"
                label={tr("Calibration due date")}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={(header.calibration_due_date as string) || ''}
                onChange={(e) => saveHeaderField('calibration_due_date', e.target.value || null)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                type="number"
                label={tr("Distance to target (m)")}
                fullWidth
                value={(header.distance_to_target_m as number) ?? ''}
                onChange={(e) => saveHeaderField('distance_to_target_m', e.target.value ? Number(e.target.value) : null)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                type="number"
                label={tr("Ambient temp (°C)")}
                fullWidth
                value={(header.ambient_temp_c as number) ?? ''}
                onChange={(e) => saveHeaderField('ambient_temp_c', e.target.value ? Number(e.target.value) : null)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                type="number"
                label={tr("Humidity (%)")}
                fullWidth
                value={(header.humidity_pct as number) ?? ''}
                onChange={(e) => saveHeaderField('humidity_pct', e.target.value ? Number(e.target.value) : null)}
              />
            </Grid>
          </Grid>

          {visit.team_id && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>{tr("Mission timing — ")}{visit.team_name}{tr(", Mission ")}{visit.mission_seq}
              </Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField
                    size="small"
                    type="time"
                    label={tr("Start time")}
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={(header.start_time as string)?.slice(0, 5) || ''}
                    onChange={(e) => saveHeaderField('start_time', e.target.value || null)}
                      />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField
                    size="small"
                    type="time"
                    label={tr("End time")}
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={(header.end_time as string)?.slice(0, 5) || ''}
                    onChange={(e) => saveHeaderField('end_time', e.target.value || null)}
                      />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    select
                    size="small"
                    label={tr("Mission status")}
                    fullWidth
                    value={(header.mission_status as string) || 'planned'}
                    onChange={(e) => saveHeaderField('mission_status', e.target.value)}
                  >
                    <MenuItem value="planned">{tr("Planned")}</MenuItem>
                    <MenuItem value="in_progress">{tr("In progress")}</MenuItem>
                    <MenuItem value="completed">{tr("Completed")}</MenuItem>
                  </TextField>
                </Grid>
              </Grid>
            </>
          )}

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>{tr("Visit GPS — this mission's tower")}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{tr("The boxed pin below is ")}{visit.tower?.tower_id || tr("this tower")}{tr(" — starts at the tower's own recorded location; drag it (or click the map) only if you need to log exactly where you stood for this visit.")}</Typography>
          <MapPicker
            // Falls back through: this visit's own saved GPS -> the tower's own recorded location, so the
            // map always shows the right tower instead of a blank/generic view when a visit has no GPS yet.
            latitude={(header.latitude as number) ?? visit.latitude ?? visit.tower?.latitude ?? null}
            longitude={(header.longitude as number) ?? visit.longitude ?? visit.tower?.longitude ?? null}
            onChange={(lat, lng) => saveHeaderFields({ latitude: lat, longitude: lng })}
            height={320}
            label={visit.tower?.tower_id}
            highlight
          />
          <Typography variant="caption">{tr("Visit details join the same draft as the positions. Confirm them together below.")}</Typography>
          {headerDraft && <Typography variant="caption" sx={{ ml: 2 }}>{tr("Draft visit details")}</Typography>}
        </CardContent>
      </Card>

      {pendingEvidence.length > 0 && (
        <Alert severity="info">{tr("Evidence check: ")}{pendingEvidence.length}{tr(" image(s) still pending across this visit. This is informational only — it doesn't hold the visit back from \"Ready for review\".")}</Alert>
      )}

      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>{tr("Inspection positions")}</Typography>
        <Stack spacing={1.5}>
          <Alert severity="info">{tr("Enter the whole visit, then use Review and save visit once. Draft fields and new evidence are saved separately from confirmed report data.")}</Alert>
          {voiceError && pendingVoice && <Alert severity="error">{tr(voiceError)}<Stack direction="row" spacing={1}>
            <Button onClick={() => void uploadVoice(pendingVoice)}>{tr("Retry recording upload")}</Button>
            <Button onClick={() => { setPendingVoice(null); setVoiceError(''); setUploadBusy(false); }}>{tr("Discard unsent recording")}</Button>
          </Stack></Alert>}
          {receipt && <Alert severity="success" onClose={() => setReceipt(null)}>
            <strong>{tr(receipt.title)}.</strong> {tr(receipt.message)}{tr(" Confirmed at ")}{receipt.time}.
          </Alert>}
          <VisitEntryToolbar visit={visit} positions={visiblePositions} lists={lists} entry={entry} images={working.images}
            onDraftsChange={setDrafts} selectedId={focusedPosition?.id ?? null} onSelect={setSelectedPositionId}
            canSaveTemplate={!isTeamMember} disabled={uploadBusy} busy={working.busy} locked={working.uncertain}
            status={working.status} draftError={tr(working.error)}
            onPrepare={(slots, remember) => working.change(prepareEntryLayout(visit, entry, slots, remember))}
            onConfirm={async () => { await working.commit(); confirmSaved('Visit saved', 'Visit details, positions and draft evidence were confirmed together.'); }}
            onLater={async () => { await working.flush(); navigate(visit.team_id ? `/teams/${visit.team_id}` : `/towers/${visit.tower_id}`); }}
            onDiscard={working.discard} onReload={working.reload} onCompareLatest={working.compareLatest} />
          <Box component="details"><Typography component="summary" sx={{ cursor: 'pointer' }}>{tr("Add an individual position or exception")}</Typography>
          <Box component="fieldset" disabled={uploadBusy || working.busy || working.uncertain} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}><AddPositionBar
            positions={allPositions}
            hiddenIds={hiddenIds}
            lists={lists}
            towerArea={visit.tower?.area}
            onAdd={handleAddPosition}
            onCreate={handleCreatePosition}
          /></Box>
          </Box>
          {visiblePositions.length === 0 && (
            <Alert severity="info">{tr("Start with “Prepare tower positions” to build the checklist, or add an individual position.")}</Alert>
          )}
          {focusedPosition && <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Button disabled={focusedIndex <= 0 || batchSaving || uploadBusy} onClick={() => setSelectedPositionId(visiblePositions[focusedIndex - 1].id)}>{tr("Previous position")}</Button>
            <Typography variant="body2">{tr("Position ")}{focusedIndex + 1}{tr(" of ")}{visiblePositions.length}</Typography>
            <Button disabled={focusedIndex >= visiblePositions.length - 1 || batchSaving || uploadBusy} onClick={() => setSelectedPositionId(visiblePositions[focusedIndex + 1].id)}>{tr("Next position")}</Button>
          </Stack>}
          {(focusedPosition ? [focusedPosition] : []).map((p) => (
            <PositionPanel
              key={p.id}
              position={drafts[p.id] ? { ...drafts[p.id].before, images: p.images } : p}
              draftValue={drafts[p.id]?.changes || {}}
              visitEntryMode
              externalSaving={batchSaving || working.uncertain}
              onUploadBusyChange={setUploadBusy}
              onDraftChange={changes => setDrafts(current => {
                if (!Object.keys(changes).length) { const next = { ...current }; delete next[p.id]; return next; }
                return mergePositionDraft(current, p, changes);
              })}
              onSave={async () => { throw new Error(tr("Use Review and save visit.")); }}
              onStageEvidence={(type, file, token) => working.upload(visit.positions.find(saved => saved.id === p.id) || p, type, file, token)}
              draftEvidence={<Stack spacing={1} sx={{ my: 1 }}>
                {pendingDraftImages.filter(i => i.position_key === p.id).map(image => <Stack key={image.id} direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                  {image.image_type === 'Voice note' ? <Box component="audio" controls src={mediaUrl(`/api/visits/${id}/entry/images/${image.id}`)} sx={{ width: 220 }} /> : <Box component="img" src={mediaUrl(`/api/visits/${id}/entry/images/${image.id}`)} alt={image.image_type} sx={{ width: 80, height: 55, objectFit: 'cover' }} />}
                  <Typography variant="caption">{tr("Draft · ")}{tr(image.image_type)} · {image.filename}</Typography>
                  <Button size="small" onClick={() => working.change(current => ({ ...current, excludedImages: [...current.excludedImages, image.id] }))}>{tr("Remove from draft")}</Button>
                </Stack>)}
              </Stack>}
              lists={lists}
              towerArea={visit.tower?.area}
              defaultExpanded
              onUploadImage={(imageId, file, meta) =>
                uploadImage.mutateAsync({
                  imageId,
                  file,
                  requestToken: meta.requestToken as string | undefined,
                  captureDate: meta.captureDate as string | undefined,
                  captureTime: meta.captureTime as string | undefined,
                  latitude: meta.latitude as number | undefined,
                  longitude: meta.longitude as number | undefined,
                })
              }
              onUpdateImage={(imageId, payload) => payload.include_in_report !== undefined ? updateImage.mutateAsync({ id: imageId, payload }) : updateImage.mutate({ id: imageId, payload })}
              onClearImageFile={(imageId) => clearImageFile.mutate(imageId)}
              onSaveAnnotation={async (imageId, blob) => {
                await saveAnnotation.mutateAsync({ imageId, blob });
              }}
              onAddExtraImage={(imageType, file, meta) =>
                addExtraImage.mutateAsync({
                  positionId: p.id,
                  imageType,
                  file,
                  requestToken: meta.requestToken as string | undefined,
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
              onDelete={async () => {
                if (p.id > 0) await deletePosition.mutateAsync(p.id);
                working.change(current => {
                  const layoutVersions = { ...current.layoutVersions }; delete layoutVersions[p.id];
                  return { ...current, layoutVersions, additions: current.additions.filter(item => item.id !== p.id), layoutIds: current.layoutIds?.filter(key => key !== p.id) || null,
                    excludedImages: [...current.excludedImages, ...working.images.filter(i => i.position_key === p.id).map(i => i.id)] };
                });
                setDrafts(current => { const next = { ...current }; delete next[p.id]; return next; });
                if (p.id > 0) confirmSaved('Deletion saved', `${positionLabel(p)} was permanently deleted. The server confirmed the deletion; this position will no longer be included in future reports.`);
              }}
              onRecordVoiceNote={(blob, durationSeconds) => {
                void uploadVoice({ position: visit.positions.find(saved => saved.id === p.id) || p,
                  file: new File([blob], 'recording.webm', { type: blob.type }), token: crypto.randomUUID(), duration: durationSeconds });
              }}
              onTranscribeVoiceNote={() => transcribeVoiceNote.mutate(p.id)}
              onDeleteVoiceNote={() => deleteVoiceNote.mutate(p.id)}
              voiceNoteSaving={uploadBusy}
              voiceNoteTranscribing={transcribeVoiceNote.isPending && transcribeVoiceNote.variables === p.id}
            />
          ))}
        </Stack>
      </Box>

      <VisitPhotosSection visitId={id} positions={visit.positions} />

    </Stack>
  );
}
