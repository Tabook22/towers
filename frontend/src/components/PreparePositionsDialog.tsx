import { useState } from 'react';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { ChoiceLists, PositionSlot, VisitDetail } from '../api/types';
import { useVisitWorkflow, type PrepareRequest } from '../api/visitWorkflow';
import { deriveDirectionFromArea, deriveDirectionsFromArea } from '../utils/direction';
import { layoutSlots } from '../utils/visitWorkflow';
import { positionError, positionLabel } from '../utils/positionChanges';

export function PreparePositionsDialog({ visit, lists, canSaveTemplate, disabled, onSaved }: {
  visit: VisitDetail; lists: ChoiceLists; canSaveTemplate: boolean; disabled: boolean; onSaved: () => void;
}) {
  const mutation = useVisitWorkflow(visit.id);
  const [open, setOpen] = useState(false);
  const [mount, setMount] = useState('Suspension');
  const [count, setCount] = useState('Double');
  const [circuits, setCircuits] = useState(lists.ohl);
  const [directions, setDirections] = useState<string[]>([]);
  const [slots, setSlots] = useState<PositionSlot[]>([]);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [review, setReview] = useState<PrepareRequest | null>(null);
  const [error, setError] = useState('');
  const towerDirections = deriveDirectionsFromArea(visit.tower?.area, lists.direction);
  const directionOptions = towerDirections.length ? towerDirections : lists.direction;
  const loadLayout = (layout: PositionSlot[]) => {
    setSlots(layout);
    if (layout[0]) { setMount(layout[0].mount_type); setCount(layout[0].string_count); }
    setCircuits([...new Set(layout.map(s => s.ohl))]);
    setDirections([...new Set(layout.map(s => s.direction))]);
  };
  const start = () => {
    const defaultDirections = [deriveDirectionFromArea(visit.tower?.area, lists.direction) || lists.direction[0]];
    loadLayout(visit.tower?.inspection_layout || layoutSlots('Suspension', lists.ohl, lists.phase, 'Double', defaultDirections));
    setReview(null); setError(''); setSaveTemplate(false); setOpen(true);
  };
  const changeLayout = (next: { mount?: string; count?: string; circuits?: string[]; directions?: string[] }) => {
    const m = next.mount ?? mount, c = next.count ?? count, o = next.circuits ?? circuits, d = next.directions ?? directions;
    setMount(m); setCount(c); setCircuits(o); setDirections(d);
    setSlots(layoutSlots(m, o, lists.phase, c, d));
  };
  const commit = async () => {
    if (!review || mutation.isPending) return;
    try {
      await mutation.mutateAsync({ kind: 'prepare', payload: review });
      setOpen(false); onSaved();
    } catch (err) { setError(positionError(err, 'Preparation was not confirmed. Your layout is kept here; reload the visit if another inspector changed it.')); }
  };
  return <>
    <Button variant="outlined" disabled={disabled} onClick={start}>Prepare tower positions</Button>
    <Dialog open={open} fullWidth maxWidth="md" onClose={() => { if (!mutation.isPending) setOpen(false); }}>
      <DialogTitle>{review ? 'Review tower layout' : 'Prepare tower positions'} — {visit.tower?.tower_id}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">Existing recorded positions and images are preserved. Unused empty slots are excluded from completion counts, not deleted. Prepared positions remain Not inspected.</Alert>
          {!review && <>
            {visit.tower?.inspection_layout && <Button onClick={() => loadLayout(visit.tower!.inspection_layout!)}>Use saved tower template</Button>}
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap' }} spacing={2}>
              <TextField select label="Tower type" value={mount} onChange={e => changeLayout({ mount: e.target.value })} sx={{ minWidth: 160 }}>{lists.mount_type.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select label="Strings per phase" value={count} onChange={e => changeLayout({ count: e.target.value })} sx={{ minWidth: 160 }}><MenuItem value="Single">1 — S1</MenuItem><MenuItem value="Double">2 — S1 Outer / S2 Inner</MenuItem></TextField>
              <TextField select label="Circuits" value={circuits} slotProps={{ select: { multiple: true } }} onChange={e => changeLayout({ circuits: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })} sx={{ minWidth: 160 }}>{lists.ohl.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select label="Direction(s)" value={directions} slotProps={{ select: { multiple: true } }} onChange={e => changeLayout({ directions: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })} sx={{ minWidth: 190 }}>{directionOptions.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
            </Stack>
            <Typography variant="body2">Review the list below. Remove unused positions for a custom layout. Include all positions that already have recorded work.</Typography>
          </>}
          <Typography sx={{ fontWeight: 700 }}>{(review?.slots || slots).length} positions in this layout</Typography>
          <Stack spacing={0.5} sx={{ maxHeight: 330, overflowY: 'auto' }}>
            {(review?.slots || slots).map((slot, index) => <Stack key={`${positionLabel(slot)}-${index}`} direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2">{positionLabel(slot)} · {slot.mount_type} · {slot.string_count === 'Double' ? (slot.string === 'S1' ? 'Outer' : 'Inner') : 'Single'}</Typography>
              {!review && <Button size="small" onClick={() => setSlots(current => current.filter((_, i) => i !== index))}>Remove from layout</Button>}
            </Stack>)}
          </Stack>
          {!review && canSaveTemplate && <FormControlLabel control={<Checkbox checked={saveTemplate} onChange={e => setSaveTemplate(e.target.checked)} />} label="Remember this layout for future visits to this tower" />}
          {review?.save_template && <Typography variant="body2">This layout will also become the tower’s template for future visits.</Typography>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={mutation.isPending} onClick={() => review ? setReview(null) : setOpen(false)}>{review ? 'Back' : 'Cancel'}</Button>
        {review ? <Button variant="contained" disabled={mutation.isPending} onClick={() => void commit()}>{mutation.isPending ? 'Waiting for server…' : 'Confirm and prepare positions'}</Button>
          : <Button variant="contained" disabled={!slots.length} onClick={() => { setError(''); setReview({ slots: slots.map(s => ({ ...s })), expected_versions: Object.fromEntries(visit.positions.map(p => [p.id, p.updated_at])), save_template: saveTemplate }); }}>Review layout</Button>}
      </DialogActions>
    </Dialog>
  </>;
}
