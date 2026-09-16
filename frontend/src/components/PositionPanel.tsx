import { useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  IconButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreRounded';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import type { ChoiceLists, ImageRow, Position } from '../api/types';
import { HotspotChip, ScreeningChip, SeverityChip } from './Badges';
import { ImageSlotCard } from './ImageSlotCard';

interface Props {
  position: Position;
  lists: ChoiceLists;
  onUpdate: (payload: Partial<Position>) => void;
  onUploadImage: (imageId: number, file: File, meta: Record<string, unknown>) => void;
  onUpdateImage: (imageId: number, payload: Partial<ImageRow>) => void;
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
  /** Only supplied for a position that was just added this session and still has no data — lets the
   * user back out of an add-by-mistake. Nothing to un-save server-side since nothing was committed. */
  onRemove?: () => void;
}

export function PositionPanel({
  position,
  lists,
  onUpdate,
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
  onRemove,
}: Props) {
  const pendingCount = position.images.filter((i) => i.evidence_status === 'PENDING CAPTURE' || i.evidence_status === 'RECAPTURE REQUIRED').length;
  const [selectedType, setSelectedType] = useState<string>(lists.image_type[0]);
  const addImagesRef = useRef<HTMLInputElement>(null);

  // Tmax/Tref/notes are free-typing fields. Committing on every keystroke (like the select fields
  // below do) would fire a PATCH — and the resulting full visit refetch/re-render of all 12
  // position panels — per character, which is what caused the typing lag: draft locally instead
  // and commit once on blur. This component instance stays bound to one position.id for its whole
  // life (parent renders it with `key={p.id}`), so seeding local state from props only on mount is
  // safe — it never needs to resync from a later prop change.
  const [tmaxDraft, setTmaxDraft] = useState<number | null>(position.tmax_c);
  const [trefDraft, setTrefDraft] = useState<number | null>(position.tref_c);
  const [notesDraft, setNotesDraft] = useState(position.inspector_notes || '');
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
    <Accordion defaultExpanded={defaultExpanded} disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 1 }}>
          <Grid container spacing={2} sx={{ flex: 1, pr: 2, alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 3 }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Typography sx={{ fontWeight: 700 }}>
                  {position.ohl} · {position.phase} · {position.string}
                </Typography>
                {position.tower_proximity && (
                  <Chip
                    size="small"
                    variant="outlined"
                    color={position.tower_proximity === 'Inner' ? 'info' : 'secondary'}
                    label={position.tower_proximity}
                  />
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {position.position_code || 'Direction not set'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <ScreeningChip result={position.screening_result} />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <HotspotChip value={position.hotspot} />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <SeverityChip severity={position.severity} />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              {pendingCount > 0 ? (
                <Chip size="small" label={`${pendingCount} image(s) pending`} color="warning" variant="outlined" />
              ) : (
                <Chip size="small" label="Evidence complete" color="success" variant="outlined" />
              )}
            </Grid>
          </Grid>
          {onRemove && (
            <Tooltip title="Remove — nothing has been filled in yet">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              >
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
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
                label="Direction"
                fullWidth
                value={position.direction || ''}
                onChange={(e) => onUpdate({ direction: e.target.value })}
              >
                {lists.direction.map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <TextField
                select
                size="small"
                label="Inner / Outer"
                fullWidth
                helperText="Only if this slot has two insulator strings"
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
                helperText={!position.installed ? 'Locked to "Not installed" until you toggle Installed on' : undefined}
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
                onChange={(e) => setTmaxDraft(e.target.value ? Number(e.target.value) : null)}
                onBlur={() => {
                  if (tmaxDraft !== position.tmax_c) onUpdate({ tmax_c: tmaxDraft });
                }}
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
                onChange={(e) => setTrefDraft(e.target.value ? Number(e.target.value) : null)}
                onBlur={() => {
                  if (trefDraft !== position.tref_c) onUpdate({ tref_c: trefDraft });
                }}
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
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={() => {
                  if (notesDraft !== (position.inspector_notes || '')) onUpdate({ inspector_notes: notesDraft });
                }}
              />
            </Grid>
          </Grid>

          {!position.direction && (
            <Typography variant="caption" color="warning.main">
              Set the Direction (EN/ES/WN/WS) to generate this position's image IDs and enable uploads.
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
              <Grid size={{ xs: 12, sm: 4, md: 2.5 }}>
                <TextField
                  select
                  size="small"
                  label="Tower type"
                  fullWidth
                  value={position.mount_type || ''}
                  onChange={(e) => onUpdate({ mount_type: e.target.value || null })}
                >
                  <MenuItem value="">
                    <em>Not set</em>
                  </MenuItem>
                  {lists.mount_type.map((t) => (
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
                  label="String count"
                  fullWidth
                  value={position.string_count || ''}
                  onChange={(e) => onUpdate({ string_count: e.target.value || null })}
                >
                  <MenuItem value="">
                    <em>Not set</em>
                  </MenuItem>
                  {lists.string_count.map((t) => (
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
              to say what the next upload(s) should be tagged as. Deleting one removes it from this list.
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
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
