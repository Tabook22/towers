import { useState } from 'react';
import { Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineRounded';
import type { ChoiceLists, Position } from '../api/types';
import { deriveDirectionFromArea, deriveDirectionsFromArea } from '../utils/direction';

// Display-only hint — S1/S2 stay the actual stored values (position codes, the 12-slot identity,
// and every existing report already key off them), this just shows which physical string each one
// conventionally is so a leader doesn't have to guess or check a separate field.
const STRING_LABELS: Record<string, string> = { S1: 'S1 — Outer', S2: 'S2 — Inner' };

function comboKey(ohl: string, phase: string, string_: string, direction: string | null) {
  return `${ohl}|${phase}|${string_}|${direction ?? ''}`;
}

interface Props {
  /** All baseline positions for this visit (the 12 canonical (OHL, phase, string) slots always
   * exist server-side — see BUILD_PROMPT's fixed ID scheme — plus any extra Tension-direction rows
   * already created). Only the ones in `hiddenIds` are offered here; everything else is already on
   * screen. */
  positions: Position[];
  hiddenIds: Set<number>;
  lists: ChoiceLists;
  /** The tower's own line/area name — used to auto-fill Direction for Suspension, and to offer
   * only this tower's own line directions (e.g. "Ashoor-Saada" -> Ashoor, Saada) for Tension. */
  towerArea?: string | null;
  onAdd: (position: Position, direction: string, mountType: string) => void;
  /** Only called for a Tension tower's second (or further) Direction on an OHL/phase/string whose
   * one baseline slot is already claimed by a different direction — see handleCreatePosition. */
  onCreate: (ohl: string, phase: string, string_: string, direction: string, mountType: string) => void;
}

export function AddPositionBar({ positions, hiddenIds, lists, towerArea, onAdd, onCreate }: Props) {
  const [mountType, setMountType] = useState('');
  const [ohl, setOhl] = useState('');
  const [direction, setDirection] = useState('');
  const [phase, setPhase] = useState('');
  const [stringVal, setStringVal] = useState('');

  const isTension = mountType === 'Tension';
  const hidden = positions.filter((p) => hiddenIds.has(p.id));
  const match = hidden.find((p) => p.ohl === ohl && p.phase === phase && p.string === stringVal);

  // This tower's own line directions (typically 2, from its area name, e.g. "Ashoor-Saada") — a
  // Tension tower needs both, not just the single best guess Suspension uses. Falls back to the
  // full choice list when the area doesn't match any of them, so nothing is ever fully blocked.
  const towerDirections = deriveDirectionsFromArea(towerArea, lists.direction);
  const tensionDirections = towerDirections.length > 0 ? towerDirections : lists.direction;

  // Every (ohl, direction, phase, string) combo already on screen (a claimed baseline slot or an
  // already-created extra) — everything else is still available to add for a Tension tower.
  const claimed = new Set(
    positions.filter((p) => !hiddenIds.has(p.id)).map((p) => comboKey(p.ohl, p.phase, p.string, p.direction)),
  );
  const tensionCombos = lists.ohl.flatMap((o) =>
    tensionDirections.flatMap((d) => lists.phase.flatMap((p) => lists.string.map((s) => ({ ohl: o, direction: d, phase: p, string: s })))),
  );
  const tensionRemaining = tensionCombos.filter((c) => !claimed.has(comboKey(c.ohl, c.phase, c.string, c.direction)));

  const reset = () => {
    setMountType('');
    setOhl('');
    setDirection('');
    setPhase('');
    setStringVal('');
  };

  if (hidden.length === 0 && tensionRemaining.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography color="text.secondary">All positions have been added.</Typography>
      </Paper>
    );
  }

  const ohlOptions = isTension ? [...new Set(tensionRemaining.map((c) => c.ohl))] : [...new Set(hidden.map((p) => p.ohl))];
  const directionOptions = isTension
    ? [...new Set(tensionRemaining.filter((c) => c.ohl === ohl).map((c) => c.direction))]
    : lists.direction;
  const phaseOptions = isTension
    ? [...new Set(tensionRemaining.filter((c) => c.ohl === ohl && c.direction === direction).map((c) => c.phase))]
    : [...new Set(hidden.filter((p) => p.ohl === ohl).map((p) => p.phase))];
  const stringOptions = isTension
    ? tensionRemaining.filter((c) => c.ohl === ohl && c.direction === direction && c.phase === phase).map((c) => c.string)
    : [...new Set(hidden.filter((p) => p.ohl === ohl && p.phase === phase).map((p) => p.string))];

  const handleAdd = () => {
    if (isTension) {
      if (!ohl || !direction || !phase || !stringVal) return;
      // The one baseline slot for this (ohl, phase, string) might still be free (direction unset) —
      // reuse it, same as any other tower type, before ever creating a brand new extra row.
      if (match) {
        onAdd(match, direction, mountType);
      } else {
        onCreate(ohl, phase, stringVal, direction, mountType);
      }
    } else {
      if (!match) return;
      onAdd(match, direction, mountType);
    }
    reset();
  };

  return (
    <Paper
      elevation={4}
      sx={{
        p: 2,
        bgcolor: '#e8f5e9',
        border: '1px solid',
        borderColor: 'success.light',
      }}
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Typography sx={{ fontWeight: 700 }}>Add position</Typography>
        <TextField
          select
          size="small"
          label="Tower type"
          value={mountType}
          onChange={(e) => {
            const value = e.target.value;
            setMountType(value);
            setOhl('');
            setPhase('');
            setStringVal('');
            // Suspension runs straight through — no direction to record. Auto-fill it from the
            // tower's own line so the position still gets a valid image code. Tension needs a real
            // choice (it can run toward more than one direction), so clear it instead.
            setDirection(value === 'Suspension' ? deriveDirectionFromArea(towerArea, lists.direction) || '' : '');
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
            if (isTension) setDirection('');
            setPhase('');
            setStringVal('');
          }}
          sx={{ minWidth: 110 }}
        >
          {ohlOptions.map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </TextField>
        {isTension && (
          <TextField
            select
            size="small"
            label="Direction"
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value);
              setPhase('');
              setStringVal('');
            }}
            disabled={!ohl}
            sx={{ minWidth: 110 }}
          >
            {directionOptions.map((d) => (
              <MenuItem key={d} value={d}>
                {d}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select
          size="small"
          label="Phase"
          value={phase}
          onChange={(e) => {
            setPhase(e.target.value);
            setStringVal('');
          }}
          disabled={isTension ? !ohl || !direction : !ohl}
          sx={{ minWidth: 110 }}
        >
          {phaseOptions.map((v) => (
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
          {stringOptions.map((v) => (
            <MenuItem key={v} value={v}>
              {STRING_LABELS[v] || v}
            </MenuItem>
          ))}
        </TextField>
        {!isTension && (
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
        )}
        <Button
          variant="contained"
          startIcon={<AddCircleOutlineIcon />}
          disabled={isTension ? !(ohl && direction && phase && stringVal) : !match}
          onClick={handleAdd}
        >
          Add
        </Button>
      </Stack>
    </Paper>
  );
}
