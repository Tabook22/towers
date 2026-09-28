import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreRounded';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SubtitlesRoundedIcon from '@mui/icons-material/SubtitlesRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import { mediaUrl } from '../api/client';
import type { ChoiceLists, ImageRow, Position } from '../api/types';
import { PositionConfiguration } from './PositionConfiguration';
import { HotspotChip, ScreeningChip, SeverityChip } from './Badges';
import { ImageSlotCard } from './ImageSlotCard';
import { VoiceNoteControls, VoiceNotePlayer } from './VoiceNoteControls';
import { positionChangeRows, positionError, positionLabel as formatPositionLabel, positionPatch } from '../utils/positionChanges';

interface Props {
  position: Position;
  lists: ChoiceLists;
  /** The tower's own line/area name (e.g. "Ashoor-Saada") — used only to auto-fill Direction the
   * moment Tower type is set to Suspension (see utils/direction.ts). */
  towerArea?: string | null;
  onSave: (payload: Partial<Position>) => Promise<unknown>;
  onDirtyChange?: (id: number, dirty: boolean) => void;
  onUploadImage: (imageId: number, file: File, meta: Record<string, unknown>) => void;
  onUpdateImage: (imageId: number, payload: Partial<ImageRow>) => void | Promise<unknown>;
  onClearImageFile: (imageId: number) => void;
  onSaveAnnotation: (imageId: number, blob: Blob) => Promise<void> | void;
  /** Adds a supplementary image beyond the one-per-type baseline slot — used once that slot already
   * has a file (see the "Add images" handler below for exactly when this fires vs. onUploadImage). */
  onAddExtraImage: (imageType: string, file: File, meta: Record<string, unknown>) => void;
  onDeleteImage: (imageId: number) => void;
  onRetypeImage: (imageId: number, newType: string) => void;
  /** Extras only: swaps this photo's content with its type's current primary image. */
  onMakePrimaryImage: (imageId: number) => void;
  annotationSaving?: boolean;
  defaultExpanded?: boolean;
  onDelete: () => Promise<void>;
  /** This position's own voice note — recording again replaces it; see backend
   * routers/positions.py's /voice endpoints for why it can never land on another position. */
  onRecordVoiceNote: (blob: Blob, durationSeconds: number) => void;
  onTranscribeVoiceNote: () => void;
  onDeleteVoiceNote: () => void;
  voiceNoteSaving?: boolean;
  voiceNoteTranscribing?: boolean;
}

export function PositionPanel({
  position: savedPosition,
  lists,
  towerArea,
  onSave,
  onDirtyChange,
  onUploadImage,
  onUpdateImage,
  onClearImageFile,
  onSaveAnnotation,
  onAddExtraImage,
  onDeleteImage,
  onRetypeImage,
  onMakePrimaryImage,
  annotationSaving,
  defaultExpanded,
  onDelete,
  onRecordVoiceNote,
  onTranscribeVoiceNote,
  onDeleteVoiceNote,
  voiceNoteSaving,
  voiceNoteTranscribing,
}: Props) {
  const [draft, setDraft] = useState<Partial<Position>>({});
  const patch = positionPatch(savedPosition, draft);
  const position = { ...savedPosition, ...draft, ...patch };
  const dirty = Object.keys(patch).length > 0;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastSaved, setLastSaved] = useState('');
  const [review, setReview] = useState<{ before: Position; patch: Partial<Position> } | null>(null);
  const saveLock = useRef(false);
  const onUpdate = (payload: Partial<Position>) => {
    setDraft(current => ({ ...current, ...payload }));
    setSaveError('');
  };
  useEffect(() => {
    onDirtyChange?.(savedPosition.id, dirty);
    return () => onDirtyChange?.(savedPosition.id, false);
  }, [savedPosition.id, dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const confirmSave = async () => {
    if (!review || saveLock.current) return;
    saveLock.current = true; setSaving(true); setSaveError('');
    try {
      await onSave(review.patch);
      setDraft({}); setReview(null); setLastSaved(new Date().toLocaleString());
    } catch (err) {
      setSaveError(positionError(err, 'Save not confirmed. Your changes remain in this draft. Check your connection and retry; do not rely on these changes in a report yet.'));
    } finally { saveLock.current = false; setSaving(false); }
  };
  const reviewChanges = () => { setSaveError(''); setReview({ before: savedPosition, patch }); };
  const discard = () => {
    if (window.confirm('Discard these unsaved position changes? The saved inspection will stay unchanged.')) {
      setDraft({}); setSaveError('');
    }
  };
  const pendingCount = position.images.filter((i) => i.evidence_status === 'PENDING CAPTURE' || i.evidence_status === 'RECAPTURE REQUIRED').length;
  const [selectedType, setSelectedType] = useState<string>(lists.image_type[0]);
  const addImagesRef = useRef<HTMLInputElement>(null);
  const configurationRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const deleteLock = useRef(false);
  const positionLabel = formatPositionLabel(savedPosition);
  const confirmDelete = async () => {
    if (!deleteAcknowledged || deleteLock.current) return;
    deleteLock.current = true;
    setDeleting(true); setDeleteError('');
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch (err) {
      setDeleteError(positionError(err, 'Deletion not confirmed. Check your connection and reload the visit to verify whether the server received the deletion before trying again.'));
    } finally { deleteLock.current = false; setDeleting(false); }
  };

  const tmaxDraft = position.tmax_c;
  const trefDraft = position.tref_c;
  const notesDraft = position.inspector_notes || '';
  const deltaT = tmaxDraft != null && trefDraft != null ? (tmaxDraft - trefDraft).toFixed(1) : null;

  // "Add images" fills the pre-existing empty baseline slot (sequence 1, seeded for every position
  // at visit-creation) first — that's the row images_pending/rollup counts. Only once it already has
  // a file does a further upload of the same type become a supplementary sequence>1 row.
  const handleAddImages = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const baseline = position.images.find((i) => i.image_type === selectedType && i.sequence === 1);
    let baselineFilled = !!baseline?.file_path;
    Array.from(files).forEach((file) => {
      if (baseline && !baselineFilled) {
        onUploadImage(baseline.id, file, {});
        baselineFilled = true;
      } else {
        onAddExtraImage(selectedType, file, {});
      }
    });
  };

  // Show every UPLOADED image for this position, not just the currently-selected type — the type
  // picker only controls what new uploads get tagged as. Grouped by image type (in the fixed list
  // order) then by sequence within each type, so all four types appear one after another instead of
  // the older behavior of hiding every type but whichever one happened to be selected.
  //
  // Empty slots (no file yet — including one just cleared by Delete) are deliberately left out of
  // this list rather than shown as an empty "No image uploaded" card: deleting one of 4 photos should
  // visibly leave 3, not turn into a placeholder. The backend still keeps that slot's row around so
  // "Add images" can silently refill it (see handleAddImages above) and the required-evidence count
  // stays correct — only the gallery display hides it.
  const typeOrder = new Map(lists.image_type.map((t, i) => [t, i]));
  const uploadedImages = position.images
    .filter((i) => !!i.file_path)
    .slice()
    .sort((a, b) => {
      const typeDiff = (typeOrder.get(a.image_type) ?? 0) - (typeOrder.get(b.image_type) ?? 0);
      return typeDiff !== 0 ? typeDiff : a.sequence - b.sequence;
    });

  return (
    <Box sx={{ position: 'relative' }}>
    <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', right: 40, top: 12, zIndex: 1 }}>
      <Button size="small" startIcon={<EditRoundedIcon />} aria-label={`Edit position ${positionLabel}`} onClick={() => {
        setExpanded(true);
        requestAnimationFrame(() => configurationRef.current?.focus());
      }}>Edit</Button>
      <Button size="small" color="error" startIcon={<DeleteRoundedIcon />} aria-label={`Delete position ${positionLabel}`} onClick={() => {
        setDeleteError(''); setDeleteAcknowledged(false); setDeleteOpen(true);
      }}>Delete</Button>
    </Stack>
    <Accordion expanded={expanded} onChange={(_, value) => setExpanded(value)} disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ '& .MuiAccordionSummary-content': { pr: { sm: 20 }, pt: { xs: 4, sm: 0 }, minHeight: 48, alignItems: 'center' } }}>
        <Box sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 1 }}>
          <Grid container spacing={2} sx={{ flex: 1, pr: 2, alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 3 }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Typography sx={{ fontWeight: 700 }}>
                  {savedPosition.ohl} · {savedPosition.phase} · {savedPosition.string_count === 'Double' ? `${savedPosition.string} — ${savedPosition.string === 'S1' ? 'Outer' : 'Inner'}` : savedPosition.string}
                </Typography>
                {savedPosition.tower_proximity && (
                  <Chip
                    size="small"
                    variant="outlined"
                    color={savedPosition.tower_proximity === 'Inner' ? 'info' : 'secondary'}
                    label={savedPosition.tower_proximity}
                  />
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {savedPosition.mount_type || 'Tower type not set'} · {savedPosition.string_count === 'Double' ? '2 strings' : savedPosition.string_count === 'Single' ? '1 string' : 'String count not set'} · {savedPosition.position_code || 'Direction not set'}
                {dirty && <Chip size="small" color="warning" label="Unsaved changes" sx={{ ml: 1 }} />}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <ScreeningChip result={savedPosition.screening_result} />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <HotspotChip value={savedPosition.hotspot} />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <SeverityChip severity={savedPosition.severity} />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              {pendingCount > 0 ? (
                <Chip size="small" label={`${pendingCount} image(s) pending`} color="warning" variant="outlined" />
              ) : (
                <Chip size="small" label="Evidence complete" color="success" variant="outlined" />
              )}
            </Grid>
          </Grid>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack component="fieldset" disabled={saving || deleting} spacing={2} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
          <Alert severity={dirty ? 'warning' : lastSaved ? 'success' : 'info'}>
            {dirty ? 'Unsaved changes — review and confirm saving before using these changes in a report.' : lastSaved ? `Saved on the server. Confirmed at ${lastSaved}.` : 'No unsaved field edits in this card. Changes require review and confirmation before saving.'}
          </Alert>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button variant="contained" disabled={!dirty || saving} onClick={reviewChanges}>Review and save changes</Button>
            <Button disabled={!dirty || saving} onClick={discard}>Discard changes</Button>
          </Stack>
          <Box ref={configurationRef} tabIndex={-1} sx={{ outline: 'none', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', borderRadius: 2 } }}>
            <PositionConfiguration position={position} lists={lists} towerArea={towerArea} onChange={onUpdate} />
          </Box>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={position.installed}
                    onChange={(e) => onUpdate({ installed: e.target.checked })}
                  />
                }
                label="Installed"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <TextField
                select
                size="small"
                label="Inner / Outer"
                fullWidth
                helperText="Only if this slot has two insulator strings"
                disabled={position.string_count === 'Single'}
                value={position.tower_proximity || ''}
                onChange={(e) => onUpdate({ tower_proximity: e.target.value || null })}
              >
                <MenuItem value="">
                  <em>Not applicable</em>
                </MenuItem>
                {lists.tower_proximity.map((p) => (
                  <MenuItem key={p} value={p}>
                    {p === 'Inner' ? 'Inner — close to tower' : 'Outer — away from tower'}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4, md: 3 }}>
              <TextField
                select
                size="small"
                label="Screening result"
                fullWidth
                disabled={!position.installed}
                helperText={
                  !position.installed
                    ? 'Locked to "Not installed" until you toggle Installed on'
                    : position.screening_result === 'Not inspected'
                      ? 'Still counts as unscreened — this is what "Inspection incomplete" means. Setting Hotspot? below fills this in automatically.'
                      : undefined
                }
                value={position.screening_result}
                onChange={(e) => onUpdate({ screening_result: e.target.value })}
              >
                {lists.screening_result.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <TextField
                select
                size="small"
                label="Hotspot?"
                fullWidth
                value={position.hotspot || ''}
                onChange={(e) => onUpdate({ hotspot: e.target.value })}
              >
                {lists.hotspot.map((h) => (
                  <MenuItem key={h} value={h}>
                    {h}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4, md: 1.5 }}>
              <TextField
                select
                size="small"
                label="Severity"
                fullWidth
                value={position.severity || ''}
                onChange={(e) => onUpdate({ severity: e.target.value })}
              >
                {lists.severity.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4, md: 1.5 }}>
              <TextField
                select
                size="small"
                label="Confidence"
                fullWidth
                value={position.confidence || ''}
                onChange={(e) => onUpdate({ confidence: e.target.value })}
              >
                {lists.confidence.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>

          <Grid container spacing={2}>
            <Grid size={{ xs: 6, sm: 3, md: 2 }}>
              <TextField
                size="small"
                type="number"
                label="Tmax (°C)"
                fullWidth
                autoComplete="off"
                value={tmaxDraft ?? ''}
                onChange={(e) => onUpdate({ tmax_c: e.target.value ? Number(e.target.value) : null })}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3, md: 2 }}>
              <TextField
                size="small"
                type="number"
                label="Tref (°C)"
                fullWidth
                autoComplete="off"
                value={trefDraft ?? ''}
                onChange={(e) => onUpdate({ tref_c: e.target.value ? Number(e.target.value) : null })}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3, md: 2 }}>
              <TextField size="small" label="ΔT (°C)" fullWidth value={deltaT ?? '-'} disabled />
            </Grid>
            <Grid size={{ xs: 12, sm: 12, md: 6 }}>
              <TextField
                size="small"
                label="Inspector notes"
                fullWidth
                autoComplete="off"
                value={notesDraft}
                onChange={(e) => onUpdate({ inspector_notes: e.target.value })}
              />
            </Grid>
          </Grid>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Voice note
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Recorded for this insulator only — S1/S2, Inner/Outer, whichever this position is, never
              mixed with any other one on this tower.
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <VoiceNoteControls
                saving={voiceNoteSaving}
                onRecorded={(blob, duration) => onRecordVoiceNote(blob, duration)}
              />
              {position.voice_note_path && (
                <Box sx={{ flex: 1, minWidth: 240 }}>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <VoiceNotePlayer
                      src={mediaUrl(`/api/positions/${position.id}/voice/audio`)}
                      duration={position.voice_note_duration_seconds}
                    />
                    <Tooltip title="Delete this recording">
                      <IconButton size="small" onClick={onDeleteVoiceNote}>
                        <CloseRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  {position.voice_note_transcript ? (
                    <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                      {position.voice_note_transcript}
                    </Typography>
                  ) : (
                    <Button
                      size="small"
                      startIcon={<SubtitlesRoundedIcon />}
                      onClick={onTranscribeVoiceNote}
                      disabled={voiceNoteTranscribing}
                      sx={{ mt: 0.5 }}
                    >
                      {voiceNoteTranscribing ? 'Converting…' : 'Convert to text'}
                    </Button>
                  )}
                </Box>
              )}
            </Stack>
          </Box>

          {!position.direction && (
            <Typography variant="caption" color="warning.main">
              Set the Direction to generate this position's image IDs and enable uploads.
            </Typography>
          )}

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Insulator record (official report)
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Fills the customer's OETC inspection report — only needed for a position that's actually going in it.
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4, md: 2.5 }}>
                <TextField
                  size="small"
                  label="Manufacturer"
                  fullWidth
                  value={position.manufacturer || ''}
                  onChange={(e) => onUpdate({ manufacturer: e.target.value || null })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4, md: 2 }}>
                <TextField
                  size="small"
                  type="number"
                  label="Year installed"
                  fullWidth
                  value={position.year_installed ?? ''}
                  onChange={(e) => onUpdate({ year_installed: e.target.value ? Number(e.target.value) : null })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4, md: 2.5 }}>
                <TextField
                  select
                  size="small"
                  label="Insulator type"
                  fullWidth
                  value={position.insulator_type || ''}
                  onChange={(e) => onUpdate({ insulator_type: e.target.value || null })}
                >
                  <MenuItem value="">
                    <em>Not set</em>
                  </MenuItem>
                  {lists.insulator_type.map((t) => (
                    <MenuItem key={t} value={t}>
                      {t}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>

              {position.mount_type === 'Tension' && (
                <Grid size={{ xs: 12, sm: 4, md: 2.5 }}>
                  <TextField
                    size="small"
                    label="GS side (which side)"
                    fullWidth
                    value={position.gs_side || ''}
                    onChange={(e) => onUpdate({ gs_side: e.target.value || null })}
                  />
                </Grid>
              )}

              <Grid size={{ xs: 12, sm: 4, md: 2.5 }}>
                <TextField
                  select
                  size="small"
                  label="Pollution condition"
                  fullWidth
                  value={position.pollution_condition || ''}
                  onChange={(e) => onUpdate({ pollution_condition: e.target.value || null })}
                >
                  <MenuItem value="">
                    <em>Not set</em>
                  </MenuItem>
                  {lists.pollution_condition.map((t) => (
                    <MenuItem key={t} value={t}>
                      {t}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4, md: 2.5 }}>
                <TextField
                  select
                  size="small"
                  label="Thermal indication"
                  fullWidth
                  value={position.thermal_indication || ''}
                  onChange={(e) => onUpdate({ thermal_indication: e.target.value || null })}
                >
                  <MenuItem value="">
                    <em>Not set</em>
                  </MenuItem>
                  {lists.thermal_indication.map((t) => (
                    <MenuItem key={t} value={t}>
                      {t}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 8, md: 5 }}>
                <Select
                  multiple
                  fullWidth
                  size="small"
                  displayEmpty
                  value={(position.visual_indications || '').split(',').filter(Boolean)}
                  onChange={(e) => {
                    const next = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                    onUpdate({ visual_indications: next.filter(Boolean).join(',') || null });
                  }}
                  renderValue={(selected) =>
                    selected.length === 0 ? (
                      <Typography color="text.secondary">Visual indications</Typography>
                    ) : (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        {selected.map((v) => (
                          <Chip key={v} size="small" label={v} />
                        ))}
                      </Stack>
                    )
                  }
                >
                  {lists.visual_indication.map((v) => (
                    <MenuItem key={v} value={v}>
                      <Checkbox checked={(position.visual_indications || '').split(',').includes(v)} size="small" />
                      <ListItemText primary={v} />
                    </MenuItem>
                  ))}
                </Select>
              </Grid>
            </Grid>
          </Box>

          <Box>
            <Stack direction="row" spacing={1.5} sx={{ mb: 0.5, alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="subtitle2">Evidence</Typography>
              <TextField
                select
                size="small"
                label="Add as type"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                sx={{ minWidth: 150 }}
              >
                {lists.image_type.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              <input
                ref={addImagesRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  handleAddImages(e.target.files);
                  e.target.value = '';
                }}
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddPhotoAlternateIcon fontSize="small" />}
                onClick={() => addImagesRef.current?.click()}
                disabled={!position.direction}
              >
                Add images
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Every uploaded image for this position, grouped by type below — pick a type above before "Add images"
              to tag the next uploads. Check "Include in report" on every image you want in the next report — you can
              choose more than one per type. Unchecked images remain supporting evidence. Saved reports are unchanged.
            </Typography>
            {uploadedImages.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No images uploaded yet — pick a type above and use "Add images".
              </Typography>
            ) : (
              <Grid container spacing={1.5}>
                {uploadedImages.map((img) => (
                  <Grid key={img.id} size={{ xs: 12, sm: 6, md: 3 }}>
                    <ImageSlotCard
                      image={img}
                      reportIncluded={img.include_in_report ?? (uploadedImages.filter(i => i.image_type === img.image_type).sort((a, b) => a.sequence - b.sequence || a.id - b.id)[0]?.id === img.id)}
                      disabled={!position.direction}
                      onUpload={(file, meta) => onUploadImage(img.id, file, meta)}
                      onUpdate={(payload) => onUpdateImage(img.id, payload)}
                      onClearFile={() => onClearImageFile(img.id)}
                      onSaveAnnotation={(blob) => onSaveAnnotation(img.id, blob)}
                      onDelete={img.sequence > 1 ? () => onDeleteImage(img.id) : undefined}
                      onRetype={(newType) => onRetypeImage(img.id, newType)}
                      otherTypes={lists.image_type.filter((t) => t !== img.image_type)}
                      onMakePrimary={() => onMakePrimaryImage(img.id)}
                      annotationSaving={annotationSaving}
                    />
                  </Grid>
                ))}
              </Grid>
            )}
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" disabled={!dirty || saving} onClick={reviewChanges}>Review and save changes</Button>
            <Button disabled={!dirty || saving} onClick={discard}>Discard changes</Button>
          </Stack>
        </Stack>
      </AccordionDetails>
    </Accordion>
    <Dialog open={!!review} onClose={() => { if (!saving) setReview(null); }} fullWidth maxWidth="md" aria-labelledby={`save-position-${position.id}`}>
      <DialogTitle id={`save-position-${position.id}`}>Confirm inspection changes</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Review changes to {positionLabel}. Confirming updates the saved inspection used in future reports.
          Already generated report documents will not change; regenerate them if these corrections must be included.
        </DialogContentText>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Position changes to confirm">
            <TableHead><TableRow><TableCell>Field</TableCell><TableCell>Currently saved</TableCell><TableCell>New value</TableCell></TableRow></TableHead>
            <TableBody>{review && positionChangeRows(review.before, review.patch).map(row => <TableRow key={row.key}>
              <TableCell>{row.label}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.before}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.after}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </Box>
        {saveError && <Alert severity="error" sx={{ mt: 2 }}>{saveError}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button autoFocus disabled={saving} onClick={() => setReview(null)}>Back to editing</Button>
        <Button variant="contained" disabled={saving} onClick={() => void confirmSave()}>{saving ? 'Saving — waiting for server…' : 'Confirm and save changes'}</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={deleteOpen} onClose={() => { if (!deleting) setDeleteOpen(false); }} aria-labelledby={`delete-position-${position.id}`}>
      <DialogTitle id={`delete-position-${position.id}`}>Delete inspection position?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Delete {positionLabel}? This permanently removes its inspection results, evidence images,
          annotations and voice note. You can add this position again to repeat the inspection.
          General visit photos and saved report documents are kept. This cannot be undone.
        </DialogContentText>
        <Alert severity="warning" sx={{ mt: 2 }}>
          This removes {savedPosition.images.filter(image => image.file_path).length} evidence image(s) and {savedPosition.voice_note_path ? '1 voice recording' : 'no voice recordings'}.
          Future reports will exclude this position. Previously generated documents are unchanged and may need to be regenerated.
        </Alert>
        {dirty && <Alert severity="warning" sx={{ mt: 1 }}>This position also has unsaved changes. Deleting it discards those changes.</Alert>}
        <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={deleteAcknowledged} disabled={deleting} onChange={event => setDeleteAcknowledged(event.target.checked)} />} label="I have checked this position and understand that deletion is permanent." />
        {deleteError && <Alert severity="error" sx={{ mt: 2 }}>{deleteError}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button autoFocus disabled={deleting} onClick={() => setDeleteOpen(false)}>Cancel</Button>
        <Button color="error" variant="contained" disabled={deleting || !deleteAcknowledged} onClick={() => void confirmDelete()}>{deleting ? 'Deleting — waiting for server…' : 'Confirm permanent deletion'}</Button>
      </DialogActions>
    </Dialog>
    </Box>
  );
}
