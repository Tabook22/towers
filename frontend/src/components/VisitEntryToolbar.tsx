import { useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import type { ChoiceLists, Position, PositionSlot, VisitDetail } from '../api/types';
import type { DraftImage } from '../api/visitEntry';
import { applySharedAssets, visitReviewIssues, type PositionDrafts } from '../utils/visitWorkflow';
import { entryHasChanges, type VisitEntry } from '../utils/visitEntry';
import { displayPositionValue, positionChangeRows, positionError, positionLabel } from '../utils/positionChanges';
import { PreparePositionsDialog } from './PreparePositionsDialog';

export function VisitEntryToolbar({ visit, positions, lists, entry, images, onDraftsChange, selectedId, onSelect, canSaveTemplate, onPrepare, onConfirm, onLater, onDiscard, onReload, onCompareLatest, status, draftError, disabled = false, busy = false, locked = false }: {
  visit: VisitDetail; positions: Position[]; lists: ChoiceLists; entry: VisitEntry; images: DraftImage[];
  onDraftsChange: (drafts: PositionDrafts) => void; selectedId: number | null; onSelect: (id: number) => void;
  canSaveTemplate: boolean; onPrepare: (slots: PositionSlot[], remember: boolean) => void;
  onConfirm: () => Promise<void>; onLater: () => Promise<void>; onDiscard: () => Promise<void>; onReload: () => Promise<void>; onCompareLatest: () => Promise<void>;
  status: string; draftError: string; disabled?: boolean; busy?: boolean; locked?: boolean;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [values, setValues] = useState<Partial<Position>>({});
  const [fillEmpty, setFillEmpty] = useState(true);
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const drafts = entry.drafts;
  const pendingImages = images.filter(i => !entry.excludedImages.includes(i.id));
  const dirty = entryHasChanges(entry) || pendingImages.length > 0;
  const selectedVisible = selected.filter(id => positions.some(p => p.id === id));
  const issues = visitReviewIssues({ ...visit, ...entry.headerDraft, positions: positions.map(p => ({ ...p,
    images: p.images.map(i => pendingImages.some(staged => staged.position_key === p.id && staged.image_type === i.image_type)
      ? { ...i, evidence_status: 'COMPLETE' } : i) })) });
  const run = async (action: () => Promise<void>) => {
    setError('');
    try { await action(); } catch (err) { setError(positionError(err, err instanceof Error ? err.message : 'Request failed; your draft is retained.')); }
  };
  return <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
      <PreparePositionsDialog visit={visit} lists={lists} disabled={disabled || busy || locked} canSaveTemplate={canSaveTemplate} onPrepare={onPrepare} />
      <Button disabled={disabled || busy || locked || !selectedVisible.length} onClick={() => { setValues({}); setSharedOpen(true); }}>Shared details ({selectedVisible.length})</Button>
      <Button variant="contained" disabled={disabled || busy || !dirty} onClick={() => { setError(''); setReview(true); }}>Review and save visit</Button>
      <Button disabled={disabled || busy || locked} onClick={() => void run(onLater)}>Save draft and finish later</Button>
    </Stack>
    <Typography variant="body2" role="status">{status}. Continue between positions freely; confirm the whole visit when ready.</Typography>
    {(error || draftError) && <Alert severity="warning">{error || draftError}<Button disabled={busy || disabled || locked} onClick={() => {
      if (window.confirm('Replace this device’s draft with the server copy? Copy any local notes you need first.')) void run(onReload);
    }}>Reload server draft</Button><Button disabled={busy || disabled || locked} onClick={() => void run(async () => { await onCompareLatest(); setReview(true); })}>Compare latest saved values</Button></Alert>}
    <TableContainer sx={{ maxHeight: 390 }}><Table size="small" stickyHeader aria-label="Inspection position checklist"><TableHead><TableRow>
      <TableCell padding="checkbox"><Checkbox slotProps={{ input: { 'aria-label': 'Select all positions' } }} checked={positions.length > 0 && selectedVisible.length === positions.length} indeterminate={selectedVisible.length > 0 && selectedVisible.length < positions.length} onChange={e => setSelected(e.target.checked ? positions.map(p => p.id) : [])} /></TableCell>
      <TableCell>Position</TableCell><TableCell>Inspection result</TableCell><TableCell>Evidence</TableCell><TableCell>Save state</TableCell>
    </TableRow></TableHead><TableBody>{positions.map(p => {
      const imageCount = pendingImages.filter(i => i.position_key === p.id).length;
      const missing = lists.image_type.filter(type => !p.images.some(i => i.image_type === type && (i.file_path || i.evidence_status === 'NOT REQUIRED')) && !pendingImages.some(i => i.position_key === p.id && i.image_type === type));
      const changed = !!drafts[p.id] || p.id < 0 || imageCount > 0 || !!entry.layoutIds;
      return <TableRow key={p.id} selected={selectedId === p.id} hover><TableCell padding="checkbox"><Checkbox slotProps={{ input: { 'aria-label': `Select ${positionLabel(p)}` } }} checked={selectedVisible.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /></TableCell>
        <TableCell><Button size="small" disabled={disabled || busy} onClick={() => onSelect(p.id)} sx={{ textAlign: 'left', justifyContent: 'flex-start' }}>{positionLabel(p)}{p.string_count === 'Double' ? ` · ${p.string === 'S1' ? 'Outer' : 'Inner'}` : ''}</Button></TableCell>
        <TableCell>{p.screening_result}</TableCell><TableCell><Typography variant="caption">{imageCount > 0 && `${imageCount} draft evidence file(s). `}{missing.length ? `Missing: ${missing.join(', ')}` : 'Complete / not required'}</Typography></TableCell>
        <TableCell><Chip size="small" color={changed ? 'warning' : 'default'} label={changed ? 'Draft' : 'Confirmed'} /></TableCell></TableRow>;
    })}</TableBody></Table></TableContainer>
    <Box component="details"><Typography component="summary" sx={{ cursor: 'pointer' }}>Visit checks · {issues.length} item(s)</Typography><Stack spacing={1} sx={{ mt: 1 }}>{issues.map(issue => <Alert key={issue} severity="warning">{issue}</Alert>)}<Typography variant="caption">Checks include drafted fields. Pending categories account for uploaded draft evidence. Missing evidence remains informational.</Typography></Stack></Box>
    {dirty && <Button color="warning" sx={{ alignSelf: 'flex-start' }} disabled={disabled || busy || locked} onClick={() => { if (window.confirm('Discard the whole working draft and its pending photos? Confirmed inspection records stay unchanged.')) void run(onDiscard); }}>Discard working draft</Button>}
  </Stack>
  <Dialog open={sharedOpen} onClose={() => setSharedOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Shared asset details — {selectedVisible.length} positions</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
    <Alert severity="info">Share manufacturer, installation year and insulator type. Observations and measurements stay individual.</Alert>
    <TextField label="Manufacturer" value={values.manufacturer || ''} onChange={e => setValues(v => ({ ...v, manufacturer: e.target.value }))} />
    <TextField label="Year installed" type="number" value={values.year_installed ?? ''} onChange={e => setValues(v => ({ ...v, year_installed: e.target.value ? Number(e.target.value) : null }))} />
    <TextField label="Insulator type" select value={values.insulator_type || ''} onChange={e => setValues(v => ({ ...v, insulator_type: e.target.value }))}><MenuItem value="">Leave unchanged</MenuItem>{lists.insulator_type.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
    <FormControlLabel control={<Checkbox checked={fillEmpty} onChange={e => setFillEmpty(e.target.checked)} />} label="Fill empty fields only" />
  </Stack></DialogContent><DialogActions><Button onClick={() => setSharedOpen(false)}>Cancel</Button><Button variant="contained" onClick={() => { onDraftsChange(applySharedAssets(drafts, positions, selectedVisible, values, fillEmpty)); setSharedOpen(false); }}>Apply to draft</Button></DialogActions></Dialog>
  <Dialog open={review} onClose={() => { if (!busy) setReview(false); }} fullWidth maxWidth="md"><DialogTitle>Review and save visit</DialogTitle><DialogContent><Stack spacing={2}>
    <Alert severity="info">This is the final confirmation. Visit details, position changes and draft evidence save together. Existing reports remain unchanged.</Alert>
    {!!entry.headerDraft && <Box><Typography variant="h6">Visit details</Typography><Table size="small"><TableHead><TableRow><TableCell>Field</TableCell><TableCell>Saved</TableCell><TableCell>Proposed</TableCell></TableRow></TableHead><TableBody>{Object.entries(entry.headerDraft).map(([key, value]) => <TableRow key={key}><TableCell>{key.replaceAll('_', ' ')}</TableCell><TableCell>{displayPositionValue(entry.headerBefore?.[key as keyof VisitDetail])}</TableCell><TableCell>{displayPositionValue(value)}</TableCell></TableRow>)}</TableBody></Table></Box>}
    {entry.layoutIds && <Alert severity="info">Layout: {entry.layoutIds.length} positions. Unused empty positions will be excluded.{entry.saveTemplate ? ' This layout will be remembered for this tower.' : ''}</Alert>}
    {entry.additions.map(p => <Box key={p.id}><Typography sx={{ fontWeight: 700 }}>New position: {positionLabel({ ...p, ...drafts[p.id]?.changes })}</Typography><Typography>{p.mount_type} · {p.string_count}</Typography></Box>)}
    {Object.values(drafts).map(item => <Box key={item.before.id}><Typography sx={{ fontWeight: 700 }}>{positionLabel({ ...item.before, ...item.changes })}</Typography><Table size="small"><TableHead><TableRow><TableCell>Field</TableCell><TableCell>Saved</TableCell><TableCell>Proposed</TableCell></TableRow></TableHead><TableBody>{positionChangeRows(item.before, item.changes).map(row => <TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell>{row.before}</TableCell><TableCell>{row.after}</TableCell></TableRow>)}</TableBody></Table></Box>)}
    {pendingImages.length > 0 && <Box><Typography sx={{ fontWeight: 700 }}>{pendingImages.length} evidence files ready to attach</Typography>{pendingImages.map(i => <Typography key={i.id} variant="body2">{positions.find(p => p.id === i.position_key) ? positionLabel(positions.find(p => p.id === i.position_key)!) : 'Position missing'} · {i.image_type} · {i.filename}</Typography>)}</Box>}
    {issues.length > 0 && <Alert severity="warning">{issues.join(' ')}</Alert>}{(error || draftError) && <Alert severity="error">{error || draftError}</Alert>}
  </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={() => setReview(false)}>Back to editing</Button><Button variant="contained" disabled={busy || disabled} onClick={() => void run(async () => { await onConfirm(); setReview(false); })}>{busy ? 'Saving visit…' : 'Confirm and save visit'}</Button></DialogActions></Dialog>
  </Paper>;
}
