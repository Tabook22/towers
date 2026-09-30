import { tr, useLanguage } from '../i18n';
import { useState } from 'react';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { ChoiceLists, PositionSlot, VisitDetail } from '../api/types';
import { deriveDirectionFromArea, deriveDirectionsFromArea } from '../utils/direction';
import { layoutSlots } from '../utils/visitWorkflow';
import { positionError, positionLabel } from '../utils/positionChanges';

export function PreparePositionsDialog({ visit, lists, canSaveTemplate, disabled, onPrepare }: {
  visit: VisitDetail; lists: ChoiceLists; canSaveTemplate: boolean; disabled: boolean; onPrepare: (slots: PositionSlot[], remember: boolean) => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [mount, setMount] = useState('Suspension');
  const [count, setCount] = useState('Double');
  const [circuits, setCircuits] = useState(lists.ohl);
  const [directions, setDirections] = useState<string[]>([]);
  const [slots, setSlots] = useState<PositionSlot[]>([]);
  const [saveTemplate, setSaveTemplate] = useState(false);
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
    setError(''); setSaveTemplate(false); setOpen(true);
  };
  const changeLayout = (next: { mount?: string; count?: string; circuits?: string[]; directions?: string[] }) => {
    const m = next.mount ?? mount, c = next.count ?? count, o = next.circuits ?? circuits, d = next.directions ?? directions;
    setMount(m); setCount(c); setCircuits(o); setDirections(d);
    setSlots(layoutSlots(m, o, lists.phase, c, d));
  };
  const apply = () => {
    try { onPrepare(slots, saveTemplate); setOpen(false); }
    catch (err) { setError(positionError(err, err instanceof Error ? err.message : tr("Check the layout."))); }
  };
  return <>
    <Button variant="outlined" disabled={disabled} onClick={start}>{tr("Prepare tower positions")}</Button>
    <Dialog open={open} fullWidth maxWidth="md" onClose={() => setOpen(false)}>
      <DialogTitle>{tr("Prepare tower positions — ")}{visit.tower?.tower_id}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">{tr("Positions will be added to your working draft. Existing observations and images are preserved. Confirm everything once with Review and save visit.")}</Alert>
          <>
            {visit.tower?.inspection_layout && <Button onClick={() => loadLayout(visit.tower!.inspection_layout!)}>{tr("Use saved tower template")}</Button>}
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap' }} spacing={2}>
              <TextField select label={tr("Tower type")} value={mount} onChange={e => changeLayout({ mount: e.target.value })} sx={{ minWidth: 160 }}>{lists.mount_type.map(v => <MenuItem key={v} value={v}>{tr(v)}</MenuItem>)}</TextField>
              <TextField select label={tr("Strings per phase")} value={count} onChange={e => changeLayout({ count: e.target.value })} sx={{ minWidth: 160 }}><MenuItem value="Single">{tr("1 — S1")}</MenuItem><MenuItem value="Double">{tr("2 — S1 Outer / S2 Inner")}</MenuItem></TextField>
              <TextField select label={tr("Circuits")} value={circuits} slotProps={{ select: { multiple: true } }} onChange={e => changeLayout({ circuits: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })} sx={{ minWidth: 160 }}>{lists.ohl.map(v => <MenuItem key={v} value={v}>{tr(v)}</MenuItem>)}</TextField>
              <TextField select label={tr("Direction(s)")} value={directions} slotProps={{ select: { multiple: true } }} onChange={e => changeLayout({ directions: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })} sx={{ minWidth: 190 }}>{directionOptions.map(v => <MenuItem key={v} value={v}>{tr(v)}</MenuItem>)}</TextField>
            </Stack>
            <Typography variant="body2">{tr("Review the list below. Remove unused positions for a custom layout. Include all positions that already have recorded work.")}</Typography>
          </>
          <Typography sx={{ fontWeight: 700 }}>{slots.length}{tr(" positions in this layout")}</Typography>
          <Stack spacing={0.5} sx={{ maxHeight: 330, overflowY: 'auto' }}>
            {slots.map((slot, index) => <Stack key={`$<bdi dir="ltr">{positionLabel(slot)}</bdi>-${index}`} direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2"><bdi dir="ltr">{positionLabel(slot)}</bdi> · {tr(slot.mount_type)} · {slot.string_count === 'Double' ? tr(slot.string === 'S1' ? 'Outer' : 'Inner') : tr("Single")}</Typography>
              {<Button size="small" onClick={() => setSlots(current => current.filter((_, i) => i !== index))}>{tr("Remove from layout")}</Button>}
            </Stack>)}
          </Stack>
          {canSaveTemplate && <FormControlLabel control={<Checkbox checked={saveTemplate} onChange={e => setSaveTemplate(e.target.checked)} />} label={tr("Remember this layout for future visits to this tower")} />}
          {error && <Alert severity="error">{tr(error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setOpen(false)}>{tr("Cancel")}</Button>
        <Button variant="contained" disabled={!slots.length} onClick={apply}>{tr("Use this layout")}</Button>
      </DialogActions>
    </Dialog>
  </>;
}
