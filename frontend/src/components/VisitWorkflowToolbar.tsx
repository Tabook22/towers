import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import type { ChoiceLists, Position, VisitDetail } from '../api/types';
import { useVisitWorkflow } from '../api/visitWorkflow';
import { applySharedAssets, mergePositionDraft, visitReviewIssues, type PositionDraft, type PositionDrafts } from '../utils/visitWorkflow';
import { positionChangeRows, positionError, positionLabel } from '../utils/positionChanges';
import { PreparePositionsDialog } from './PreparePositionsDialog';

export function VisitWorkflowToolbar({ visit, positions, lists, drafts, onDraftsChange, selectedId, onSelect, canSaveTemplate, onSaved, onBusyChange, disabled = false }: {
  disabled?: boolean;
  visit: VisitDetail; positions: Position[]; lists: ChoiceLists; drafts: PositionDrafts;
  onDraftsChange: (drafts: PositionDrafts) => void; selectedId: number | null; onSelect: (id: number) => void;
  canSaveTemplate: boolean; onSaved: (message: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const mutation = useVisitWorkflow(visit.id);
  const qc = useQueryClient();
  const [reloading, setReloading] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [values, setValues] = useState<Partial<Position>>({});
  const [fillEmpty, setFillEmpty] = useState(true);
  const [review, setReview] = useState<PositionDraft[] | null>(null);
  const [error, setError] = useState('');
  const dirtyCount = Object.keys(drafts).length;
  const selectedVisible = selected.filter(id => positions.some(p => p.id === id));
  const issues = visitReviewIssues(visit);
  const reloadDrafts = async () => {
    setReloading(true);
    try {
      const { data } = await apiClient.get<VisitDetail>(`/api/visits/${visit.id}`);
      if (Object.keys(drafts).some(id => !data.positions.some(p => p.id === Number(id)))) {
        setError('A drafted position was deleted. Copy any notes you need from this review, then use Discard all drafts before continuing.'); return;
      }
      qc.setQueryData(['visit', visit.id], data);
      let next: PositionDrafts = {};
      for (const item of Object.values(drafts)) next = mergePositionDraft(next, data.positions.find(p => p.id === item.before.id)!, item.changes);
      onDraftsChange(next); setReview(Object.values(next));
      setError('Latest saved values loaded. Your proposed edits are retained. Compare both columns again before confirming.');
    } catch { setError('Could not reload saved values. Drafts are retained.'); }
    finally { setReloading(false); }
  };
  const save = async () => {
    if (!review?.length || mutation.isPending || reloading) return;
    onBusyChange(true); setError('');
    try {
      await mutation.mutateAsync({ kind: 'batch', payload: { items: review.map(item => ({ id: item.before.id, expected_updated_at: item.before.updated_at, changes: item.changes })) } });
      onDraftsChange({}); setReview(null); onSaved(`${review.length} position(s) saved together. The server confirmed all changes.`);
    } catch (err) { setError(positionError(err, 'Save not confirmed. Your drafts are retained; check your connection before retrying.')); }
    finally { onBusyChange(false); }
  };
  return <Paper variant="outlined" sx={{ p: 2 }}>
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
        <PreparePositionsDialog visit={visit} lists={lists} disabled={disabled || dirtyCount > 0 || mutation.isPending} canSaveTemplate={canSaveTemplate} onSaved={() => onSaved('Tower positions prepared. Existing inspection data was preserved.')} />
        <Button disabled={disabled || !selectedVisible.length || mutation.isPending} onClick={() => { setValues({}); setSharedOpen(true); }}>Shared details ({selectedVisible.length})</Button>
        <Button variant="contained" disabled={disabled || !dirtyCount || mutation.isPending} onClick={() => { setError(''); setReview(Object.values(drafts).map(d => ({ before: { ...d.before }, changes: { ...d.changes } }))); }}>Review and save {dirtyCount || 'all'} changed position{dirtyCount === 1 ? '' : 's'}</Button>
        {!!dirtyCount && <Button color="warning" disabled={disabled || mutation.isPending} onClick={() => {
          if (window.confirm('Discard all unsaved position drafts on this device? Saved inspection data will stay unchanged.')) { onDraftsChange({}); setReview(null); setError(''); }
        }}>Discard all drafts</Button>}
      </Stack>
      <Typography variant="body2" color="text.secondary">Select rows to share asset details. Open a position to record observations and evidence. All edits remain drafts until confirmed.</Typography>
      <TableContainer sx={{ maxHeight: 390 }}>
        <Table size="small" stickyHeader aria-label="Inspection position checklist">
          <TableHead><TableRow>
            <TableCell padding="checkbox"><Checkbox slotProps={{ input: { 'aria-label': 'Select all positions' } }} checked={positions.length > 0 && selectedVisible.length === positions.length} indeterminate={selectedVisible.length > 0 && selectedVisible.length < positions.length} onChange={e => setSelected(e.target.checked ? positions.map(p => p.id) : [])} /></TableCell>
            <TableCell>Position</TableCell><TableCell>Inspection result</TableCell><TableCell>Evidence</TableCell><TableCell>Save state</TableCell>
          </TableRow></TableHead>
          <TableBody>{positions.map(p => {
            const draft = drafts[p.id]; const current = { ...p, ...draft?.changes };
            const missing = p.images.filter(i => i.sequence === 1 && !['COMPLETE', 'NOT REQUIRED'].includes(i.evidence_status)).map(i => i.image_type);
            return <TableRow key={p.id} selected={selectedId === p.id} hover>
              <TableCell padding="checkbox"><Checkbox slotProps={{ input: { 'aria-label': `Select ${positionLabel(p)}` } }} checked={selectedVisible.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /></TableCell>
              <TableCell><Button size="small" disabled={disabled || mutation.isPending} onClick={() => onSelect(p.id)} sx={{ textAlign: 'left', justifyContent: 'flex-start' }}>{positionLabel(p)}{p.string_count === 'Double' ? ` · ${p.string === 'S1' ? 'Outer' : 'Inner'}` : ''}</Button></TableCell>
              <TableCell>{current.screening_result}</TableCell>
              <TableCell><Typography variant="caption">{missing.length ? `Missing: ${missing.join(', ')}` : 'Complete / not required'}</Typography></TableCell>
              <TableCell><Chip size="small" color={draft ? 'warning' : 'default'} label={draft ? 'Unsaved draft' : 'Saved'} /></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </TableContainer>
      <Box component="details"><Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>Visit checks — {issues.length ? `${issues.length} item(s) to review` : 'No missing items detected'}</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>{issues.map(issue => <Alert key={issue} severity="warning">{issue}</Alert>)}<Typography variant="caption">These checks use saved data. Pending evidence remains informational; review the official report before issuing it.</Typography></Stack>
      </Box>
    </Stack>
    <Dialog open={sharedOpen} onClose={() => setSharedOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>Shared asset details — {selectedVisible.length} positions</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Alert severity="info">Only manufacturer, installation year and insulator type are shared. Observations, temperatures and images stay individual. Review the resulting drafts before saving.</Alert>
        <TextField label="Manufacturer" value={values.manufacturer || ''} onChange={e => setValues(v => ({ ...v, manufacturer: e.target.value }))} />
        <TextField label="Year installed" type="number" value={values.year_installed ?? ''} onChange={e => setValues(v => ({ ...v, year_installed: e.target.value ? Number(e.target.value) : null }))} />
        <TextField label="Insulator type" select value={values.insulator_type || ''} onChange={e => setValues(v => ({ ...v, insulator_type: e.target.value }))}><MenuItem value="">Leave unchanged</MenuItem>{lists.insulator_type.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
        <FormControlLabel control={<Checkbox checked={fillEmpty} onChange={e => setFillEmpty(e.target.checked)} />} label="Fill empty fields only (preserve individual exceptions)" />
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setSharedOpen(false)}>Cancel</Button><Button variant="contained" onClick={() => { onDraftsChange(applySharedAssets(drafts, positions, selectedVisible, values, fillEmpty)); setSharedOpen(false); }}>Apply to drafts</Button></DialogActions>
    </Dialog>
    <Dialog open={!!review} onClose={() => { if (!mutation.isPending) setReview(null); }} fullWidth maxWidth="md">
      <DialogTitle>Review {review?.length} changed positions</DialogTitle>
      <DialogContent><Stack spacing={2}>
        <Alert severity="info">All changes save together after server validation. A conflict or invalid entry leaves the entire batch unsaved.</Alert>
        {review?.map(item => <Box key={item.before.id}><Typography sx={{ fontWeight: 700 }}>{positionLabel(item.before)}</Typography><Table size="small"><TableHead><TableRow><TableCell>Field</TableCell><TableCell>Saved</TableCell><TableCell>Proposed</TableCell></TableRow></TableHead><TableBody>{positionChangeRows(item.before, item.changes).map(row => <TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell>{row.before}</TableCell><TableCell>{row.after}</TableCell></TableRow>)}</TableBody></Table></Box>)}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={mutation.isPending || reloading} onClick={() => setReview(null)}>Back to editing</Button><Button disabled={mutation.isPending || reloading} onClick={() => void reloadDrafts()}>Reload saved values for comparison</Button><Button variant="contained" disabled={mutation.isPending || reloading || !review?.length} onClick={() => void save()}>{mutation.isPending ? 'Waiting for server…' : 'Confirm and save all changes'}</Button></DialogActions>
    </Dialog>
  </Paper>;
}
