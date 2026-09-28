import { useEffect, useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { ChoiceLists, Position } from '../api/types';
import { deriveDirectionFromArea } from '../utils/direction';

export function PositionConfiguration({ position, lists, towerArea, onSave }: {
  position: Position; lists: ChoiceLists; towerArea?: string | null;
  onSave: (payload: Partial<Position>) => Promise<unknown>;
}) {
  const [mount, setMount] = useState(position.mount_type || '');
  const [count, setCount] = useState(position.string_count || '');
  const [string, setString] = useState(position.string_count ? position.string : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setMount(position.mount_type || ''); setCount(position.string_count || '');
    setString(position.string_count ? position.string : ''); setError('');
  }, [position.id, position.mount_type, position.string_count, position.string]);
  const changed = mount !== (position.mount_type || '') || count !== (position.string_count || '') || string !== position.string;
  const valid = !!mount && !!count && (string === 'S1' || (count === 'Double' && string === 'S2'));
  const stringLabel = count === 'Double' ? (string === 'S1' ? 'S1 — Outer' : 'S2 — Inner') : 'S1';
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true); setError('');
    try {
      const payload: Partial<Position> = { mount_type: mount, string_count: count, string, tower_proximity: count === 'Double' ? (string === 'S1' ? 'Outer' : 'Inner') : null };
      if (mount === 'Suspension' && !position.direction) {
        const direction = deriveDirectionFromArea(towerArea, lists.direction);
        if (direction) payload.direction = direction;
      }
      await onSave(payload);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Could not save this configuration. Please try again.');
    } finally { setSaving(false); }
  };
  return <Stack spacing={1.5} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
    <Typography variant="subtitle2">Position configuration · {position.ohl}</Typography>
    <Stack component="fieldset" disabled={saving} direction="row" spacing={1.5} sx={{ m: 0, p: 0, border: 0, flexWrap: 'wrap', gap: 1.5 }}>
      <TextField select size="small" label="Tower type" value={mount} onChange={e => setMount(e.target.value)} sx={{ minWidth: 140 }}>
        {lists.mount_type.map(type => <MenuItem key={type} value={type}>{type}</MenuItem>)}
      </TextField>
      <TextField size="small" label="Phase" value={position.phase} slotProps={{ input: { readOnly: true } }} sx={{ width: 90 }} />
      <TextField select size="small" label="Number of strings" value={count} onChange={e => { setCount(e.target.value); setString(''); }} sx={{ minWidth: 160 }}>
        <MenuItem value="Single">1</MenuItem><MenuItem value="Double">2</MenuItem>
      </TextField>
      <TextField select size="small" label="String" disabled={!count} value={string} onChange={e => setString(e.target.value)} sx={{ minWidth: 160 }}>
        {count && <MenuItem value="S1">{count === 'Double' ? 'S1 — Outer' : 'S1'}</MenuItem>}
        {count === 'Double' && <MenuItem value="S2">S2 — Inner</MenuItem>}
      </TextField>
      <Button variant="outlined" disabled={!valid || !changed || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save configuration'}</Button>
    </Stack>
    <Typography variant="caption" color="text.secondary">{mount || 'Choose tower type'} · Phase {position.phase} · {count ? `${count === 'Single' ? 1 : 2} string${count === 'Double' ? 's' : ''}` : 'Choose number of strings'} · {string ? stringLabel : 'Choose string position'}</Typography>
    {error && <Alert severity="error">{error}</Alert>}
  </Stack>;
}
