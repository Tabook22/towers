import { MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { ChoiceLists, Position } from '../api/types';
import { deriveDirectionFromArea } from '../utils/direction';

/** Configuration fields share the parent position's unsaved draft. */
export function PositionConfiguration({ position, lists, towerArea, onChange }: {
  position: Position; lists: ChoiceLists; towerArea?: string | null;
  onChange: (payload: Partial<Position>) => void;
}) {
  return <Stack spacing={1.5} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
    <Typography variant="subtitle2">Position configuration</Typography>
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
      <TextField select size="small" label="Tower type" value={position.mount_type || ''} onChange={e => {
        const mount_type = e.target.value;
        const direction = mount_type === 'Suspension' && !position.direction ? deriveDirectionFromArea(towerArea, lists.direction) : null;
        onChange({ mount_type, ...(direction ? { direction } : {}) });
      }} sx={{ minWidth: 140 }}>
        {lists.mount_type.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="OHL" value={position.ohl} onChange={e => onChange({ ohl: e.target.value })} sx={{ minWidth: 110 }}>
        {lists.ohl.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Phase" value={position.phase} onChange={e => onChange({ phase: e.target.value })} sx={{ minWidth: 90 }}>
        {lists.phase.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Number of strings" value={position.string_count || ''} onChange={e => onChange({
        string_count: e.target.value, string: e.target.value === 'Single' ? 'S1' : position.string,
      })} sx={{ minWidth: 160 }}>
        <MenuItem value="Single">1</MenuItem><MenuItem value="Double">2</MenuItem>
      </TextField>
      <TextField select size="small" label="String" disabled={!position.string_count} value={position.string} onChange={e => onChange({ string: e.target.value })} sx={{ minWidth: 160 }}>
        <MenuItem value="S1">{position.string_count === 'Double' ? 'S1 — Outer' : 'S1'}</MenuItem>
        {(position.string_count === 'Double' || position.string === 'S2') && <MenuItem value="S2">S2 — Inner</MenuItem>}
      </TextField>
      <TextField select size="small" label="Direction" value={position.direction || ''} onChange={e => onChange({ direction: e.target.value })} sx={{ minWidth: 140 }}>
        {lists.direction.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
      </TextField>
    </Stack>
  </Stack>;
}
