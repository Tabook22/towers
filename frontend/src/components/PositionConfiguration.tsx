import { tr, useLanguage } from '../i18n';
import { MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { ChoiceLists, Position } from '../api/types';


/** Configuration fields share the parent position's unsaved draft. */
export function PositionConfiguration({ position, lists, towerArea, onChange }: {
  position: Position; lists: ChoiceLists; towerArea?: string | null;
  onChange: (payload: Partial<Position>) => void;
}) {
  useLanguage();
  return <Stack spacing={1.5} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
    <Typography variant="subtitle2">{tr("Position configuration")}</Typography>
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
      <TextField select size="small" label={tr('Viewing side')} value={position.view_side || 'Unspecified'} onChange={e => onChange({ view_side: e.target.value })} sx={{ minWidth: 180 }}>
        <MenuItem value="Unspecified">{tr('View not recorded')}</MenuItem><MenuItem value="Front">{tr('Front view')}</MenuItem><MenuItem value="Back">{tr('Back view')}</MenuItem>
      </TextField>
      <TextField select size="small" label={tr("Tower type")} value={position.mount_type || ''} onChange={e => {
        const mount_type = e.target.value;
        const direction = mount_type === 'Suspension' && !position.direction ? 'NA' : null;
        onChange({ mount_type, ...(direction ? { direction } : {}), ...(mount_type !== 'Suspension' && position.direction === 'NA' ? { direction: null } : {}) });
      }} sx={{ minWidth: 140 }}>
        {lists.mount_type.map(value => <MenuItem key={value} value={value}>{tr(value)}</MenuItem>)}
      </TextField>
      <TextField select size="small" label={tr("OHL")} value={position.ohl} onChange={e => onChange({ ohl: e.target.value })} sx={{ minWidth: 110 }}>
        {lists.ohl.map(value => <MenuItem key={value} value={value}>{tr(value)}</MenuItem>)}
      </TextField>
      <TextField select size="small" label={tr("Phase")} value={position.phase} onChange={e => onChange({ phase: e.target.value })} sx={{ minWidth: 90 }}>
        {lists.phase.map(value => <MenuItem key={value} value={value}>{tr(value)}</MenuItem>)}
      </TextField>
      <TextField select size="small" label={tr("Number of strings")} value={position.string_count || ''} onChange={e => onChange({
        string_count: e.target.value, string: e.target.value === 'Single' ? 'S1' : position.string,
      })} sx={{ minWidth: 160 }}>
        <MenuItem value="Single">1</MenuItem><MenuItem value="Double">2</MenuItem>
      </TextField>
      <TextField select size="small" label={tr("String")} disabled={!position.string_count} value={position.string} onChange={e => onChange({ string: e.target.value })} sx={{ minWidth: 160 }}>
        <MenuItem value="S1">{position.string_count === 'Double' ? tr("S1 — Outer") : tr("S1")}</MenuItem>
        {(position.string_count === 'Double' || position.string === 'S2') && <MenuItem value="S2">{tr("S2 — Inner")}</MenuItem>}
      </TextField>
      {position.mount_type === 'Suspension' ? <TextField size="small" label={tr('Line')} value={towerArea || tr('Not needed for Suspension')} slotProps={{ input: { readOnly: true } }} /> : <TextField select size="small" label={tr("Direction")} value={position.direction || ''} onChange={e => onChange({ direction: e.target.value })} sx={{ minWidth: 140 }}>
        {[...new Set([...lists.direction, ...(position.direction && position.direction !== 'NA' ? [position.direction] : [])])].map(value => <MenuItem key={value} value={value}>{tr(value)}</MenuItem>)}
      </TextField>}
    </Stack>
  </Stack>;
}
