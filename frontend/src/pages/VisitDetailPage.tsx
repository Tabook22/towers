import { tr, useLanguage, locale } from '../i18n';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
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
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { InspectionDisclosure } from '../components/InspectionDisclosure';
import AddLocationAltRounded from '@mui/icons-material/AddLocationAltRounded';
import NavigateBeforeRounded from '@mui/icons-material/NavigateBeforeRounded';
import NavigateNextRounded from '@mui/icons-material/NavigateNextRounded';
import { DashboardSection } from '../components/DashboardSection';
import AssignmentIndRounded from '@mui/icons-material/AssignmentIndRounded';
import CameraAltRounded from '@mui/icons-material/CameraAltRounded';
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import PlaceRounded from '@mui/icons-material/PlaceRounded';
import DrawRounded from '@mui/icons-material/DrawRounded';
import { VisitStatusChip } from '../components/Badges';
import { MapPicker } from '../components/MapPicker';
import { PositionPanel } from '../components/PositionPanel';
import { AddPositionBar } from '../components/AddPositionBar';
import { VisitPhotosSection } from '../components/VisitPhotosSection';
import TransmissionTowerIcon from '../components/TransmissionTowerIcon';
import FactCheckIcon from '@mui/icons-material/FactCheckRounded';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import PendingActionsIcon from '@mui/icons-material/PendingActionsRounded';
import { inspectionCheck } from '../i18n/inspection';
import { positionLabel } from '../utils/positionChanges';
import { VisitEntryToolbar } from '../components/VisitEntryToolbar';
import { useVisitEntry } from '../api/visitEntry';
import { addEntryPosition, entryHasChanges, entryPositions, prepareEntryLayout } from '../utils/visitEntry';
import { VisitEquipmentPreset } from '../components/VisitEquipmentPreset';
import { mergePositionDraft, visitReviewChecks, type VisitReviewCheck, type VisitCheckTarget, type PositionDrafts } from '../utils/visitWorkflow';
import { evidenceProgress } from '../utils/inspectionProgress';
import { VisualTowerForm } from '../components/VisualTowerForm';
import { editVisualReading, prepareVisualEntry } from '../utils/visualTower';

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

function VisitFieldGroup({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return <Box sx={{ p: { xs: 2, sm: 2.5 }, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '20px' }}>
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', mb: 2.5 }}>
      <Box sx={{ display: 'grid', placeItems: 'center', p: 1.25, borderRadius: '14px', bgcolor: 'action.hover', color: 'primary.main' }}>{icon}</Box>
      <Box><Typography component="h3" sx={{ fontWeight: 800 }}>{title}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>{description}</Typography></Box>
    </Stack>
    {children}
  </Box>;
}

export function VisitDetailPage() {
  useLanguage();
  const { visitId } = useParams();
  return <VisitDetailWorkspace key={visitId} />;
}

function VisitDetailWorkspace() {
  useLanguage();
  const { visitId } = useParams();
  const id = Number(visitId);
  const [searchParams] = useSearchParams();
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
  const [visualInvalid, setVisualInvalid] = useState(false);
  const [positionInvalid, setPositionInvalid] = useState(false);
  const [sharedRequest, setSharedRequest] = useState<{ ids: number[]; request: number }>();
  const [visualOpen, setVisualOpen] = useState(false);
  const [reviewRequest, setReviewRequest] = useState(0);
  const positionEditor = useRef<HTMLDivElement>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [positionsExpanded, setPositionsExpanded] = useState(true);
  const inspectorInput = useRef<HTMLInputElement>(null);
  const inspectionDateInput = useRef<HTMLInputElement>(null);
  const [activeCheck, setActiveCheck] = useState<VisitReviewCheck | null>(null);
  const [checkFocus, setCheckFocus] = useState<{ target: VisitCheckTarget; request: number } | undefined>();
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
    const added = entryPositions(visit, next).find(p => p.ohl === slot.ohl && p.phase === slot.phase && p.string === slot.string && p.direction === slot.direction && (p.view_side || 'Unspecified') === (slot.view_side || 'Unspecified'));
    setSelectedPositionId(added?.id || null);
  };
  const handleAddPosition = async (position: Position, direction: string, mountType: string, stringCount: string, viewSide: string) => {
    addSlot({ ohl: position.ohl, phase: position.phase, string: position.string, direction, mount_type: mountType, string_count: stringCount, view_side: viewSide });
  };
  const handleCreatePosition = async (ohl: string, phase: string, string_: string, direction: string, mountType: string, stringCount: string, viewSide: string) => {
    addSlot({ ohl, phase, string: string_, direction, mount_type: mountType, string_count: stringCount, view_side: viewSide });
  };
  const checks = visitReviewChecks({ ...visit, ...entry.headerDraft, positions: visiblePositions },
    { imageTypes: lists.image_type, stagedEvidence: pendingDraftImages });
  const currentCheck = checks.find(check => check.target === activeCheck?.target);
  // Keep the original queue while editing so resolving a field never moves the user mid-entry.
  const checkPositions = activeCheck ? visiblePositions.filter(p => activeCheck.positionIds.includes(p.id) || currentCheck?.positionIds.includes(p.id)) : visiblePositions;
  const focusedPosition = checkPositions.find(p => p.id === selectedPositionId) || checkPositions[0];
  const focusedIndex = checkPositions.findIndex(p => p.id === focusedPosition?.id);
  const openPosition = (positionId: number, target?: VisitCheckTarget) => {
    if (positionInvalid) return;
    setPositionsExpanded(true);
    setSelectedPositionId(positionId);
    setCheckFocus(target ? { target, request: Date.now() } : undefined);
    requestAnimationFrame(() => positionEditor.current?.scrollIntoView({ block: 'start' }));
  };
  const openCheck = (check: VisitReviewCheck) => {
    if (check.positionIds.length) {
      setActiveCheck(check);
      openPosition(check.positionIds[0], check.target);
    } else {
      setDetailsExpanded(true);
      const input = check.target === 'inspector_name' ? inspectorInput.current : inspectionDateInput.current;
      requestAnimationFrame(() => { input?.scrollIntoView({ block: 'center' }); input?.focus({ preventScroll: true }); });
    }
  };
  const draftInstalled = visiblePositions.filter(p => p.installed);
  const draftScreened = draftInstalled.filter(p => p.screening_result !== 'Not inspected');
  const draftMissing = visiblePositions.reduce((total, p) => total + evidenceProgress(p, lists.image_type, pendingDraftImages).missing.length, 0);
  const shownRollup = hasDraft ? { installed: draftInstalled.length, screened: draftScreened.length,
    completion_pct: draftInstalled.length ? Math.round(draftScreened.length / draftInstalled.length * 1000) / 10 : 0,
    hotspots: visiblePositions.filter(p => p.hotspot === 'Yes').length, images_pending: draftMissing } : visit.rollup;
  const invalidHumidity = header.humidity_pct != null && (!Number.isFinite(Number(header.humidity_pct)) || Number(header.humidity_pct) < 0 || Number(header.humidity_pct) > 100);

  const voiceFeedback = (voiceError && pendingVoice && <Alert severity="error">{tr(voiceError)}<Stack direction="row" spacing={1}>
            <Button onClick={() => void uploadVoice(pendingVoice)}>{tr("Retry recording upload")}</Button>
            <Button onClick={() => { setPendingVoice(null); setVoiceError(''); setUploadBusy(false); }}>{tr("Discard unsent recording")}</Button>
          </Stack></Alert>);
  const renderPositionPanel = (p: Position, inWorkspace = false, workspaceFocus?: { target: VisitCheckTarget; request: number }, onInvalid?: (invalid: boolean) => void) => (
<PositionPanel
              key={p.id}
              position={drafts[p.id] ? { ...drafts[p.id].before, images: p.images } : p}
              stagedImages={pendingDraftImages}
              compact={inWorkspace}
              draftValue={drafts[p.id]?.changes || {}}
              visitEntryMode
              checkFocus={inWorkspace ? workspaceFocus : checkFocus}
              externalSaving={batchSaving || working.uncertain}
              onUploadBusyChange={setUploadBusy}
              onInvalidChange={onInvalid || setPositionInvalid}
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
                  replace: meta.replace as boolean | undefined,
                  expectedChecksum: meta.expectedChecksum as string | undefined,
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
  );
  const visitHeader = (
<DashboardSection tone="amber" icon={<AssignmentIndRounded />} title={tr("Visit details")} eyebrow={tr("1 · PREPARE THE VISIT")}
        description={tr("Record the inspector, equipment and site conditions once for this visit and its report.")}
        expanded={detailsExpanded} onExpandedChange={setDetailsExpanded}
        badge={<Typography variant="caption">{header.inspection_date as string || tr("Date not set")} · {header.inspector_name as string || tr("Set inspector and equipment")}</Typography>}>
        <Box component="fieldset" disabled={working.busy || uploadBusy || working.uncertain} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <Stack spacing={2.5}>
          <VisitFieldGroup icon={<AssignmentIndRounded />} title={tr("Inspector & visit setup")} description={tr("Set the visit date, inspector and camera settings. Reuse your equipment preset to save time.")}>
          <VisitEquipmentPreset visit={{ ...visit, ...headerDraft }} userId={String(user?.id || user?.username)} inspectorName={user?.full_name || user?.username || ''}
            onApply={async payload => saveHeaderFields(payload)} />
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                type="date"
                label={tr("Inspection date")}
                inputRef={inspectionDateInput}
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
                inputRef={inspectorInput}
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
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                type="number"
                label={tr("Emissivity")}
                fullWidth
                value={(header.emissivity as number) ?? ''}
                onChange={(e) => saveHeaderField('emissivity', e.target.value ? Number(e.target.value) : null)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
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

          </VisitFieldGroup>
          <VisitFieldGroup icon={<CameraAltRounded />} title={tr("Equipment & environment (official report)")} description={tr("Record calibration details and measured site conditions for the official report.")}>
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

          </VisitFieldGroup>
          {visit.team_id && (
            <VisitFieldGroup icon={<AccessTimeRounded />} title={tr("Visit timing")} description={tr("Record when the crew started and finished. Scheduling status is separate from inspection readiness.")}>
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
                    label={tr("Scheduling status")}
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
            </VisitFieldGroup>
          )}

          <VisitFieldGroup icon={<PlaceRounded />} title={tr("Visit GPS — this mission's tower")} description={tr("Check the tower location. Adjust the pin only when recording a different observation point.")}>
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
          </VisitFieldGroup>
          <Typography variant="caption">{tr("Visit details join the same draft as the positions. Confirm them together below.")}</Typography>
          {headerDraft && <Typography variant="caption" sx={{ ml: 2 }}>{tr("Draft visit details")}</Typography>}
        </Stack>
        </Box>
      </DashboardSection>
  );

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
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
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

      <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '24px' }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'grid', placeItems: 'center', p: 1.5, borderRadius: '18px', bgcolor: 'primary.main', color: 'primary.contrastText' }}><TransmissionTowerIcon sx={{ fontSize: 36 }} /></Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {visit.tower?.tower_id}{tr(" — Field Inspection Visit")}</Typography>
          <VisitStatusChip status={visit.rollup?.visit_status} />
          {visit.team_id && (
            <Chip
              icon={<GroupsIcon />}
              label={visit.mission_seq == null ? visit.team_name : tr("{0} — Inspection visit {1}", [visit.team_name, visit.mission_seq])}
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

      {shownRollup && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label={tr(hasDraft ? "Draft screened / installed" : "Screened / Installed")} value={`${shownRollup.screened}/${shownRollup.installed}`} icon={<TransmissionTowerIcon />} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label={tr(hasDraft ? "Draft screening" : "Completion")} value={`${shownRollup.completion_pct}%`} icon={<FactCheckIcon />} color="#3a6f84" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label={tr(hasDraft ? "Draft hotspots" : "Hotspots")} value={shownRollup.hotspots} icon={<LocalFireDepartmentIcon />} color="#d32f2f" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <KpiTile label={tr(hasDraft ? "Draft evidence pending" : "Images pending")} value={shownRollup.images_pending} icon={<PendingActionsIcon />} color="#f57c00" />
          </Grid>
        </Grid>
      )}

      {!visualOpen && visitHeader}
      <DashboardSection icon={<DrawRounded />} tone="blue" title={tr("Visual inspection workspace")} eyebrow={tr("2 · INSPECT ON THE DRAWING")}
        description={tr("Open the tower drawing to enter readings and attach evidence to the correct position and viewing side.")}>
      <VisualTowerForm visit={{ ...visit, ...headerDraft }} positions={allPositions} lists={lists}
        userKey={user?.username || ''}
        stagedImages={pendingDraftImages} status={working.status} draftError={working.error}
        onOpenChange={open => { setVisualOpen(open); if (open) setDetailsExpanded(true); }} visitDetails={visitHeader} feedback={voiceFeedback}
        initialOpen={searchParams.get('entry') === 'visual'} navigationBusy={uploadBusy}
        checks={checks} onHeaderCheck={openCheck}
        renderPositionDetails={(p, focus, onInvalid) => renderPositionPanel(p, true, focus, onInvalid)}
        onShared={ids => setSharedRequest({ ids, request: Date.now() })}
        onReview={() => { setPositionsExpanded(true); setReviewRequest(value => value + 1); }}
        onLater={async () => { await working.flush(); navigate(visit.team_id ? `/teams/${visit.team_id}` : `/towers/${visit.tower_id}`); }}
        disabled={working.busy || working.uncertain || positionInvalid} onInvalid={setVisualInvalid}
        onHeader={saveHeaderFields}
        onPrepare={slots => working.change(current => prepareVisualEntry(visit, current, slots))}
        onReading={(slots, slot, changes) => working.change(current => editVisualReading(visit, current, slots, slot, changes))}
        onDone={positionId => { setPositionsExpanded(true); setActiveCheck(null); setCheckFocus(undefined); if (positionId != null) setSelectedPositionId(positionId); requestAnimationFrame(() => positionEditor.current?.scrollIntoView({ block: 'start' })); }} />
      </DashboardSection>
      {invalidHumidity && <Alert severity="error">{tr('Humidity must be between 0 and 100% before confirming the visit.')}</Alert>}

      {!hasDraft && pendingEvidence.length > 0 && (
        <Alert severity="info">{tr("Evidence check: ")}{pendingEvidence.length}{tr(" image(s) still pending across this visit. This is informational only — it doesn't hold the visit back from \"Ready for review\".")}</Alert>
      )}

      <DashboardSection icon={<FactCheckIcon />} tone="teal" title={tr("Inspection positions")} eyebrow={tr("3 · CHECK & CONFIRM")}
        description={tr("Review each position, resolve missing checks and confirm the whole visit once. These confirmed records feed the report.")}
        expanded={positionsExpanded} onExpandedChange={setPositionsExpanded}
        badge={<Typography variant="caption">{tr("{0} inspection positions", [visiblePositions.length])}</Typography>}>
        <Stack spacing={1.5}>
          <Alert severity="info">{tr("Enter the whole visit, then use Review and save visit once. Draft fields and new evidence are saved separately from confirmed report data.")}</Alert>
          {!visualOpen && voiceFeedback}
          {receipt && <Alert severity="success" onClose={() => setReceipt(null)}>
            <strong>{tr(receipt.title)}.</strong> {tr(receipt.message)}{tr(" Confirmed at ")}{receipt.time}.
          </Alert>}
          <VisitEntryToolbar visit={visit} positions={visiblePositions} lists={lists} entry={entry} images={working.images}
            sharedRequest={sharedRequest}
            onDraftsChange={setDrafts} selectedId={focusedPosition?.id ?? null} onSelect={positionId => { setActiveCheck(null); openPosition(positionId); }} checks={checks} onOpenCheck={openCheck} reviewRequest={reviewRequest} navigationBusy={uploadBusy}
            canSaveTemplate={!isTeamMember} disabled={uploadBusy || visualInvalid || positionInvalid || invalidHumidity} busy={working.busy} locked={working.uncertain}
            status={working.status} draftError={tr(working.error)}
            onPrepare={(slots, remember) => working.change(prepareEntryLayout(visit, entry, slots, remember))}
            onConfirm={async reviewedImageIds => { await working.commit(reviewedImageIds); confirmSaved('Visit saved', 'Visit details, positions and draft evidence were confirmed together.'); }}
            onLater={async () => { await working.flush(); navigate(visit.team_id ? `/teams/${visit.team_id}` : `/towers/${visit.tower_id}`); }}
            onDiscard={working.discard} onReload={working.reload} onCompareLatest={working.compareLatest} />
          <InspectionDisclosure icon={<AddLocationAltRounded />} title={tr("Add an individual position or exception")} description={tr('Need an extra position? Follow these three groups. For a whole tower, use Prepare tower positions above.')} >
          <Box component="fieldset" disabled={uploadBusy || working.busy || working.uncertain} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}><AddPositionBar
            positions={allPositions}
            hiddenIds={hiddenIds}
            lists={lists}
            towerArea={visit.tower?.area}
            onAdd={handleAddPosition}
            onCreate={handleCreatePosition}
          /></Box>
          </InspectionDisclosure>
          {visiblePositions.length === 0 && (
            <Alert severity="info">{tr("Start with “Prepare tower positions” to build the checklist, or add an individual position.")}</Alert>
          )}
          {activeCheck && <Alert severity={currentCheck ? 'info' : 'success'} action={<Button color="inherit" disabled={batchSaving || uploadBusy} onClick={() => { setActiveCheck(null); setCheckFocus(undefined); }}>{tr("Show all positions")}</Button>}>
            <Typography sx={{ fontWeight: 700 }}>{currentCheck ? inspectionCheck(currentCheck.message) : tr("All checks in this group are resolved in the current draft.")}</Typography>
            <Typography variant="caption">{tr("Move through the affected positions below. Your entries remain in the visit draft.")}</Typography>
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
              {checkPositions.map(p => <Button key={p.id} size="small" variant={focusedPosition?.id === p.id ? 'contained' : 'outlined'}
                disabled={batchSaving || uploadBusy} onClick={() => openPosition(p.id, activeCheck.target)}>
                <bdi dir="ltr">{positionLabel(p)}</bdi>{!currentCheck?.positionIds.includes(p.id) && <span aria-label={tr("Resolved")}> ✓</span>}
              </Button>)}
            </Stack>
          </Alert>}
          {focusedPosition && <Stack ref={positionEditor} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'space-between', alignItems: 'center', p: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '18px', scrollMarginTop: 90 }}>
            <Button variant="outlined" startIcon={<NavigateBeforeRounded sx={{ transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />} disabled={focusedIndex <= 0 || batchSaving || uploadBusy} onClick={() => openPosition(checkPositions[focusedIndex - 1].id, activeCheck?.target)}>{tr("Previous position")}</Button>
            <Stack spacing={.75} sx={{ textAlign: 'center', minWidth: 160 }}><Typography variant="body2" sx={{ fontWeight: 800 }}>{tr("Position ")}{focusedIndex + 1}{tr(" of ")}{checkPositions.length}{activeCheck ? ` · ${tr("Affected positions")}` : ''}</Typography><Typography variant="caption" color="text.secondary">{tr('Move between positions without confirming each one.')}</Typography></Stack>
            <Button variant="contained" endIcon={<NavigateNextRounded sx={{ transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />} disabled={focusedIndex >= checkPositions.length - 1 || batchSaving || uploadBusy} onClick={() => openPosition(checkPositions[focusedIndex + 1].id, activeCheck?.target)}>{tr("Next position")}</Button>
          </Stack>}
          {!visualOpen && focusedPosition && renderPositionPanel(focusedPosition)}
        </Stack>
      </DashboardSection>

      <VisitPhotosSection visitId={id} positions={visit.positions} />

    </Stack>
  );
}
