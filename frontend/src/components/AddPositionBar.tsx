import { useState } from 'react';
import { Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineRounded';
import type { ChoiceLists, Position } from '../api/types';

interface Props {
  /** All 12 canonical positions for this visit (they always exist server-side — see BUILD_PROMPT's
   * fixed ID scheme). Only the ones in `hiddenIds` are offered here; everything else is already on
   * screen. */
  positions: Position[];
  hiddenIds: Set<number>;
  lists: ChoiceLists;
  onAdd: (position: Position, direction: string) => void;
}

export function AddPositionBar({ positions, hiddenIds, lists, onAdd }: Props) {
  const [ohl, setOhl] = useState('');
  const [phase, setPhase] = useState('');
  const [stringVal, setStringVal] = useState('');
  const [direction, setDirection] = useState('');

  const hidden = positions.filter((p) => hiddenIds.has(p.id));
  const match = hidden.find((p) => p.ohl === ohl && p.phase === phase && p.string === stringVal);

  const reset = () => {
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
          sx={{ minWidth: 110 }}
        >
          {[...new Set(hidden.filter((p) => p.ohl === ohl && p.phase === phase).map((p) => p.string))].map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
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
            onAdd(match, direction);
            reset();
          }}
        >
          Add
        </Button>
      </Stack>
    </Paper>
  );
}
