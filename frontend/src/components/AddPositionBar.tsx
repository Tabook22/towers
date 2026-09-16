import { useState } from 'react';
import { Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineRounded';
import type { ChoiceLists, Position } from '../api/types';

// Display-only hint — S1/S2 stay the actual stored values (position codes, the 12-slot identity,
// and every existing report already key off them), this just shows which physical string each one
// conventionally is so a leader doesn't have to guess or check a separate field.
const STRING_LABELS: Record<string, string> = { S1: 'S1 — Outer', S2: 'S2 — Inner' };

interface Props {
  /** All 12 canonical positions for this visit (they always exist server-side — see BUILD_PROMPT's
   * fixed ID scheme). Only the ones in `hiddenIds` are offered here; everything else is already on
   * screen. */
  positions: Position[];
  hiddenIds: Set<number>;
  lists: ChoiceLists;
  onAdd: (position: Position, direction: string, mountType: string) => void;
}

export function AddPositionBar({ positions, hiddenIds, lists, onAdd }: Props) {
  const [mountType, setMountType] = useState('');
  const [ohl, setOhl] = useState('');
  const [phase, setPhase] = useState('');
  const [stringVal, setStringVal] = useState('');
  const [direction, setDirection] = useState('');

  const hidden = positions.filter((p) => hiddenIds.has(p.id));
  const match = hidden.find((p) => p.ohl === ohl && p.phase === phase && p.string === stringVal);

  const reset = () => {
    setMountType('');
    setOhl('');
    setPhase('');
    setStringVal('');
    setDirection('');
  };

  if (hidden.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography color="text.secondary">All 12 positions have been added.</Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Typography sx={{ fontWeight: 700 }}>Add position</Typography>
        <TextField
          select
          size="small"
          label="Tower type"
          value={mountType}
          onChange={(e) => {
            setMountType(e.target.value);
            if (e.target.value === 'Suspension') setDirection('');
          }}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="">—</MenuItem>
          {lists.mount_type.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="OHL"
          value={ohl}
          onChange={(e) => {
            setOhl(e.target.value);
            setPhase('');
            setStringVal('');
          }}
          sx={{ minWidth: 110 }}
        >
          {[...new Set(hidden.map((p) => p.ohl))].map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Phase"
          value={phase}
          onChange={(e) => {
            setPhase(e.target.value);
            setStringVal('');
          }}
          disabled={!ohl}
          sx={{ minWidth: 110 }}
        >
          {[...new Set(hidden.filter((p) => p.ohl === ohl).map((p) => p.phase))].map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="String"
          value={stringVal}
          onChange={(e) => setStringVal(e.target.value)}
          disabled={!phase}
          sx={{ minWidth: 150 }}
        >
          {[...new Set(hidden.filter((p) => p.ohl === ohl && p.phase === phase).map((p) => p.string))].map((v) => (
            <MenuItem key={v} value={v}>
              {STRING_LABELS[v] || v}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          disabled={mountType === 'Suspension'}
          helperText={mountType === 'Suspension' ? 'Not needed for Suspension' : undefined}
          sx={{ minWidth: 110 }}
        >
          <MenuItem value="">—</MenuItem>
          {lists.direction.map((d) => (
            <MenuItem key={d} value={d}>
              {d}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="contained"
          startIcon={<AddCircleOutlineIcon />}
          disabled={!match}
          onClick={() => {
            if (!match) return;
            onAdd(match, direction, mountType);
            reset();
          }}
        >
          Add
        </Button>
      </Stack>
    </Paper>
  );
}
