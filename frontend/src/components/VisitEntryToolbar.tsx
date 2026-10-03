import { tr, useLanguage } from '../i18n';
import { inspectionValue, inspectionCheck, visitFieldLabels } from '../i18n/inspection';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import type { ChoiceLists, Position, PositionSlot, VisitDetail } from '../api/types';
import type { DraftImage } from '../api/visitEntry';
import { applySharedAssets, type VisitReviewCheck, type PositionDrafts } from '../utils/visitWorkflow';
import { entryHasChanges, type VisitEntry } from '../utils/visitEntry';
import { positionChangeRows, positionError, positionLabel } from '../utils/positionChanges';
import { InspectionDisclosure } from './InspectionDisclosure';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import { PreparePositionsDialog } from './PreparePositionsDialog';
import { PositionImageGallery } from './PositionImageGallery';
import { evidenceProgress } from '../utils/inspectionProgress';

export function VisitEntryToolbar({ visit, positions, lists, entry, images, onDraftsChange, selectedId, onSelect, checks, onOpenCheck, reviewRequest = 0, sharedRequest, navigationBusy = false, canSaveTemplate, onPrepare, onConfirm, onLater, onDiscard, onReload, onCompareLatest, status, draftError, disabled = false, busy = false, locked = false }: {
  visit: VisitDetail; positions: Position[]; lists: ChoiceLists; entry: VisitEntry; images: DraftImage[];
  onDraftsChange: (drafts: PositionDrafts) => void; selectedId: number | null; onSelect: (id: number) => void;
  reviewRequest?: number; checks: VisitReviewCheck[]; onOpenCheck: (check: VisitReviewCheck) => void; navigationBusy?: boolean;
  sharedRequest?: { ids: number[]; request: number };
  canSaveTemplate: boolean; onPrepare: (slots: PositionSlot[], remember: boolean) => void;
  onConfirm: (reviewedImageIds: number[]) => Promise<void>; onLater: () => Promise<void>; onDiscard: () => Promise<void>; onReload: () => Promise<void>; onCompareLatest: () => Promise<void>;
  status: string; draftError: string; disabled?: boolean; busy?: boolean; locked?: boolean;
}) {
  useLanguage();
  const [selected, setSelected] = useState<number[]>([]);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [values, setValues] = useState<Partial<Position>>({});
  const [fillEmpty, setFillEmpty] = useState(true);
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const latestImages = useRef(images);
  useEffect(() => { latestImages.current = images; }, [images]);
  const [reviewedImageIds, setReviewedImageIds] = useState<number[]>([]);
  const openReview = () => { setError(''); setReviewedImageIds(latestImages.current.map(image => image.id)); setReview(true); };
  useEffect(() => { if (reviewRequest) { setError(''); setReviewedImageIds(latestImages.current.map(image => image.id)); setReview(true); } }, [reviewRequest]);
  useEffect(() => { if (sharedRequest) { setSelected(sharedRequest.ids); setValues({}); setFillEmpty(true); setSharedOpen(true); } }, [sharedRequest]);
  const drafts = entry.drafts;
  const pendingImages = images.filter(i => !entry.excludedImages.includes(i.id));
  const dirty = entryHasChanges(entry) || pendingImages.length > 0;
  const selectedVisible = selected.filter(id => positions.some(p => p.id === id));
  // Keep front/back observations of the same physical string adjacent for comparison.
  const tablePositions = [...positions].sort((a, b) => {
    const key = (p: Position) => [p.ohl, ({ R: 0, Y: 1, B: 2 } as Record<string, number>)[p.phase] ?? 3, p.string, p.direction || ''].join('|');
    const side = (p: Position) => p.view_side === 'Front' ? 0 : p.view_side === 'Back' ? 1 : 2;
    return key(a).localeCompare(key(b)) || side(a) - side(b);
  });
  const checkButtons = checks.map(check => <Alert key={check.target} severity="warning" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
    <Button disabled={busy || navigationBusy} onClick={() => { setReview(false); onOpenCheck(check); }}
      sx={{ width: '100%', justifyContent: 'space-between', textAlign: 'start', gap: 2, color: 'inherit' }}>
      <span>{inspectionCheck(check.message)}</span><span aria-hidden="true">↗</span>
    </Button>
  </Alert>);
  const run = async (action: () => Promise<void>) => {
    setError('');
    try { await action(); } catch (err) { setError(positionError(err, err instanceof Error ? err.message : tr("Request failed; your draft is retained."))); }
  };
  return <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
      <PreparePositionsDialog visit={visit} lists={lists} disabled={disabled || busy || locked} canSaveTemplate={canSaveTemplate} onPrepare={onPrepare} />
      <Button disabled={disabled || busy || locked || !selectedVisible.length} onClick={() => { setValues({}); setSharedOpen(true); }}>{tr("Shared details (")}{selectedVisible.length})</Button>
      <Button variant="contained" disabled={disabled || busy || !dirty} onClick={openReview}>{tr("Review and save visit")}</Button>
      <Button disabled={disabled || busy || locked} onClick={() => void run(onLater)}>{tr("Save draft and finish later")}</Button>
    </Stack>
    <Typography variant="body2" role="status">{tr(status)}{tr(". Continue between positions freely; confirm the whole visit when ready.")}</Typography>
    {(error || draftError) && <Alert severity="warning">{tr(error || draftError)}<Button disabled={busy || disabled || locked} onClick={() => {
      if (window.confirm(tr("Replace this device’s draft with the server copy? Copy any local notes you need first."))) void run(onReload);
    }}>{tr("Reload server draft")}</Button><Button disabled={busy || disabled || locked} onClick={() => void run(async () => { await onCompareLatest(); openReview(); })}>{tr("Compare latest saved values")}</Button></Alert>}
    <TableContainer sx={{ maxHeight: 390 }}><Table size="small" stickyHeader aria-label={tr("Inspection position checklist")}><TableHead><TableRow>
      <TableCell padding="checkbox"><Checkbox slotProps={{ input: { 'aria-label': tr("Select all positions") } }} checked={positions.length > 0 && selectedVisible.length === positions.length} indeterminate={selectedVisible.length > 0 && selectedVisible.length < positions.length} onChange={e => setSelected(e.target.checked ? positions.map(p => p.id) : [])} /></TableCell>
      <TableCell>{tr("Position")}</TableCell><TableCell>{tr("Viewing side")}</TableCell><TableCell>Tmax / Tref / ΔT (°C)</TableCell><TableCell>{tr("Inspection result")}</TableCell><TableCell>{tr("Evidence")}</TableCell><TableCell>{tr("Save state")}</TableCell>
    </TableRow></TableHead><TableBody>{tablePositions.map(p => {
      const imageCount = pendingImages.filter(i => i.position_key === p.id).length;
      const missing = evidenceProgress(p, lists.image_type, pendingImages).missing;
      const changed = !!drafts[p.id] || p.id < 0 || imageCount > 0 || !!entry.layoutIds;
      return <TableRow key={p.id} selected={selectedId === p.id} hover><TableCell padding="checkbox"><Checkbox slotProps={{ input: { 'aria-label': tr("Select {0}", [positionLabel(p)]) } }} checked={selectedVisible.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /></TableCell>
        <TableCell><Button size="small" disabled={disabled || busy} onClick={() => onSelect(p.id)} sx={{ textAlign: 'left', justifyContent: 'flex-start' }}><bdi dir="ltr">{positionLabel(p)}</bdi>{p.string_count === 'Double' ? ` · ${tr(p.string === 'S1' ? 'Outer' : 'Inner')}` : ''}</Button><PositionImageGallery position={p} stagedImages={pendingImages} /></TableCell>
        <TableCell><Chip size="small" variant="outlined" color={p.view_side === 'Front' ? 'info' : p.view_side === 'Back' ? 'secondary' : 'warning'} label={tr(p.view_side === 'Front' ? 'Front view' : p.view_side === 'Back' ? 'Back view' : 'View not recorded')} /></TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap' }}><bdi>{p.tmax_c ?? '—'} / {p.tref_c ?? '—'} / {p.tmax_c != null && p.tref_c != null ? Math.round((p.tmax_c - p.tref_c) * 100) / 100 : '—'}</bdi></TableCell>
        <TableCell>{tr(p.screening_result)}</TableCell><TableCell><Typography variant="caption">{imageCount > 0 && tr("{0} draft evidence file(s). ", [imageCount])}{missing.length ? tr("Missing: {0}", [missing.map(type => tr(type)).join(', ')]) : tr("Complete / not required")}</Typography></TableCell>
        <TableCell><Chip size="small" color={changed ? 'warning' : 'default'} label={changed ? tr("Draft") : tr("Confirmed")} /></TableCell></TableRow>;
    })}</TableBody></Table></TableContainer>
    <InspectionDisclosure icon={<FactCheckRounded />} title={tr('Visit checks · {0} items', [checks.length])} description={tr('Open a check to jump directly to the field or position that needs attention.')}><Stack spacing={1} sx={{ mt: 1 }}>{checkButtons}<Typography variant="caption">{tr("Checks include drafted fields. Pending categories account for uploaded draft evidence. Missing evidence remains informational.")}</Typography></Stack></InspectionDisclosure>
    {dirty && <Button color="warning" sx={{ alignSelf: 'flex-start' }} disabled={disabled || busy || locked} onClick={() => { if (window.confirm(tr("Discard the whole working draft and its pending photos? Confirmed inspection records stay unchanged."))) void run(onDiscard); }}>{tr("Discard working draft")}</Button>}
  </Stack>
  <Dialog open={sharedOpen} onClose={() => setSharedOpen(false)} fullWidth maxWidth="sm"><DialogTitle>{tr("Shared asset details — ")}{selectedVisible.length}{tr(" positions")}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
    <Alert severity="info">{tr("Share manufacturer, installation year and insulator type. Observations and measurements stay individual.")}</Alert>
    <TextField label={tr("Manufacturer")} value={values.manufacturer || ''} onChange={e => setValues(v => ({ ...v, manufacturer: e.target.value }))} />
    <TextField label={tr("Year installed")} type="number" value={values.year_installed ?? ''} onChange={e => setValues(v => ({ ...v, year_installed: e.target.value ? Number(e.target.value) : null }))} />
    <TextField label={tr("Insulator type")} select value={values.insulator_type || ''} onChange={e => setValues(v => ({ ...v, insulator_type: e.target.value }))}><MenuItem value="">{tr("Leave unchanged")}</MenuItem>{lists.insulator_type.map(v => <MenuItem key={v} value={v}>{tr(v)}</MenuItem>)}</TextField>
    <FormControlLabel control={<Checkbox checked={fillEmpty} onChange={e => setFillEmpty(e.target.checked)} />} label={tr("Fill empty fields only")} />
  </Stack></DialogContent><DialogActions><Button onClick={() => setSharedOpen(false)}>{tr("Cancel")}</Button><Button variant="contained" onClick={() => { onDraftsChange(applySharedAssets(drafts, positions, selectedVisible, values, fillEmpty)); setSharedOpen(false); }}>{tr("Apply to draft")}</Button></DialogActions></Dialog>
  <Dialog open={review} disableRestoreFocus onClose={() => { if (!busy) setReview(false); }} fullWidth maxWidth="md"><DialogTitle>{tr("Review and save visit")}</DialogTitle><DialogContent><Stack spacing={2}>
    <Alert severity="info">{tr("This is the final confirmation. Visit details, position changes and draft evidence save together. Existing reports remain unchanged.")}</Alert>
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Chip label={tr('Positions changed: {0}', [new Set([...Object.keys(drafts).map(Number), ...entry.additions.map(p => p.id)]).size])} />
      <Chip label={tr('Draft evidence files: {0}', [pendingImages.length])} />
    </Stack>
    {checkButtons}
    <Box component="details"><Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 700 }}>{tr('Show all proposed changes')}</Typography>
    <Stack spacing={2} sx={{ mt: 2 }}>
    {!!entry.headerDraft && <Box><Typography variant="h6">{tr("Visit details")}</Typography><Table size="small"><TableHead><TableRow><TableCell>{tr("Field")}</TableCell><TableCell>{tr("Saved")}</TableCell><TableCell>{tr("Proposed")}</TableCell></TableRow></TableHead><TableBody>{Object.entries(entry.headerDraft).map(([key, value]) => <TableRow key={key}><TableCell>{tr(visitFieldLabels[key] || key.replaceAll('_', ' '))}</TableCell><TableCell>{inspectionValue(key, entry.headerBefore?.[key as keyof VisitDetail])}</TableCell><TableCell>{inspectionValue(key, value)}</TableCell></TableRow>)}</TableBody></Table></Box>}
    {entry.layoutIds && <Alert severity="info">{tr("Layout: ")}{entry.layoutIds.length}{tr(" positions. Unused empty positions will be excluded.")}{entry.saveTemplate ? tr(" This layout will be remembered for this tower.") : ''}</Alert>}
    {entry.additions.map(p => <Box key={p.id}><Typography sx={{ fontWeight: 700 }}>{tr("New position: ")}{positionLabel({ ...p, ...drafts[p.id]?.changes })}</Typography><Typography>{tr(p.mount_type)} · {tr(p.string_count)}</Typography></Box>)}
    {Object.values(drafts).map(item => <Box key={item.before.id}><Typography sx={{ fontWeight: 700 }}>{positionLabel({ ...item.before, ...item.changes })}</Typography><Table size="small"><TableHead><TableRow><TableCell>{tr("Field")}</TableCell><TableCell>{tr("Saved")}</TableCell><TableCell>{tr("Proposed")}</TableCell></TableRow></TableHead><TableBody>{positionChangeRows(item.before, item.changes).map(row => <TableRow key={row.key}><TableCell>{tr(row.label)}</TableCell><TableCell>{inspectionValue(row.key, item.before[row.key as keyof Position])}</TableCell><TableCell>{inspectionValue(row.key, item.changes[row.key as keyof Position])}</TableCell></TableRow>)}</TableBody></Table></Box>)}
    {pendingImages.length > 0 && <Box><Typography sx={{ fontWeight: 700 }}>{pendingImages.length}{tr(" evidence files ready to attach")}</Typography>{pendingImages.map(i => <Typography key={i.id} variant="body2">{positions.find(p => p.id === i.position_key) ? positionLabel(positions.find(p => p.id === i.position_key)!) : tr("Position missing")} · {tr(i.image_type)} · {i.filename}</Typography>)}</Box>}
    </Stack></Box>
    {(error || draftError) && <Alert severity="error">{tr(error || draftError)}</Alert>}
  </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={() => setReview(false)}>{tr("Back to editing")}</Button><Button variant="contained" disabled={busy || disabled} onClick={() => void run(async () => { await onConfirm(reviewedImageIds); setReview(false); })}>{busy ? tr("Saving visit…") : tr("Confirm and save visit")}</Button></DialogActions></Dialog>
  </Paper>;
}
